# apps/invoices/tests/test_designs.py
"""
Step 8 — design_data schema validation (apps/invoices/design_schema.py),
the 3 seed decompositions (apps/invoices/design_seeds.py) dogfooded
against that same validator, and the real CRUD/set-default/duplicate
endpoints (apps/invoices/views.py). No canvas UI involved — that's
Step 8b, built against this contract.
"""
import copy
from django.core.cache import cache
from django.urls import reverse

from apps.invoices.design_schema import validate_design_data_schema
from apps.invoices.design_seeds import BUILTIN_DESIGNS, get_builtin_design_data
from apps.invoices.models import InvoiceDesign
from apps.invoices.tests.test_views import InvoicesAPITestCase
from apps.users.models import User


# ══════════════════════════════════════════════════════════════════
# SCHEMA VALIDATION — pure function, no DB/API involved
# ══════════════════════════════════════════════════════════════════

class DesignSchemaValidationTests(InvoicesAPITestCase):
    """Reuses InvoicesAPITestCase only for BASE_DESIGN below, not for any HTTP calls."""

    BASE_DESIGN = BUILTIN_DESIGNS['professional']

    def test_valid_design_passes_with_no_errors(self):
        self.assertEqual(validate_design_data_schema(copy.deepcopy(self.BASE_DESIGN)), [])

    def test_non_dict_payload_rejected(self):
        self.assertTrue(validate_design_data_schema('not a dict'))
        self.assertTrue(validate_design_data_schema(None))
        self.assertTrue(validate_design_data_schema([]))

    def test_missing_zone_1_rejected(self):
        d = copy.deepcopy(self.BASE_DESIGN)
        del d['zone_1']
        errors = validate_design_data_schema(d)
        self.assertIn('design_data.zone_1 is required.', errors)

    def test_missing_zone_2_rejected(self):
        d = copy.deepcopy(self.BASE_DESIGN)
        del d['zone_2']
        errors = validate_design_data_schema(d)
        self.assertIn('design_data.zone_2 is required.', errors)

    def test_missing_line_items_table_rejected(self):
        """The line-items table is structurally mandatory — a design_data payload without it must fail."""
        d = copy.deepcopy(self.BASE_DESIGN)
        del d['zone_2']['table']
        errors = validate_design_data_schema(d)
        self.assertTrue(any('zone_2.table' in e for e in errors), errors)

    def test_missing_totals_block_rejected(self):
        """The totals block is structurally mandatory too."""
        d = copy.deepcopy(self.BASE_DESIGN)
        d['zone_2']['elements'] = [e for e in d['zone_2']['elements'] if e['type'] != 'totals']
        errors = validate_design_data_schema(d)
        self.assertTrue(any('totals block' in e for e in errors), errors)

    def test_zone_1_overlap_detected_with_real_colliding_fixture(self):
        """Intentionally colliding fixture — not synthetic-only, uses the real seed as its base."""
        d = copy.deepcopy(self.BASE_DESIGN)
        d['zone_1']['elements'][1]['x'] = d['zone_1']['elements'][0]['x']
        d['zone_1']['elements'][1]['y'] = d['zone_1']['elements'][0]['y']
        errors = validate_design_data_schema(d)
        self.assertTrue(any('overlaps' in e for e in errors), errors)

    def test_zone_1_non_overlapping_elements_pass(self):
        # The base fixture itself is the non-overlapping case — already asserted valid above,
        # this test documents that expectation explicitly for the overlap rule specifically.
        d = copy.deepcopy(self.BASE_DESIGN)
        errors = validate_design_data_schema(d)
        self.assertFalse(any('overlaps' in e for e in errors), errors)

    def test_zone_2_elements_structurally_cannot_overlap(self):
        """No x/y on zone_2 elements at all — nothing to collision-check, by construction."""
        for element in self.BASE_DESIGN['zone_2']['elements']:
            self.assertNotIn('x', element)
            self.assertNotIn('y', element)

    def test_paired_side_by_side_requires_exactly_two(self):
        d = copy.deepcopy(self.BASE_DESIGN)
        d['zone_2']['elements'][-1]['paired_side_by_side'] = False  # now only 1 of the original 2 remains
        errors = validate_design_data_schema(d)
        self.assertTrue(any('exactly two' in e for e in errors), errors)

    def test_paired_side_by_side_rejects_non_pairable_types(self):
        """notes/totals are not in the fixed-height, non-reflowing set — pairing them must be rejected."""
        d = copy.deepcopy(self.BASE_DESIGN)
        # Turn off the seed's real (valid) pair, turn on an invalid one instead.
        for element in d['zone_2']['elements']:
            if element.get('paired_side_by_side'):
                element['paired_side_by_side'] = False
        d['zone_2']['elements'][1]['paired_side_by_side'] = True  # notes
        d['zone_2']['elements'][2]['paired_side_by_side'] = True  # payment_info (bank methods)
        errors = validate_design_data_schema(d)
        # payment_info IS pairable, notes is not — exactly the notes element should be flagged.
        self.assertTrue(any('notes' in e and 'not pairable' in e for e in errors), errors)

    def test_paired_side_by_side_accepts_signature_and_payment_info(self):
        """The seed's real pairing (QR payment_info + signature) must not be flagged."""
        errors = validate_design_data_schema(copy.deepcopy(self.BASE_DESIGN))
        self.assertFalse(any('not pairable' in e for e in errors), errors)

    def test_invalid_zone_1_element_type_rejected(self):
        d = copy.deepcopy(self.BASE_DESIGN)
        d['zone_1']['elements'][0]['type'] = 'not_a_real_type'
        errors = validate_design_data_schema(d)
        self.assertTrue(any('invalid type' in e for e in errors), errors)

    def test_invalid_zone_2_element_type_rejected(self):
        d = copy.deepcopy(self.BASE_DESIGN)
        d['zone_2']['elements'][0]['type'] = 'not_a_real_type'
        errors = validate_design_data_schema(d)
        self.assertTrue(any('invalid type' in e for e in errors), errors)

    def test_zone_1_element_missing_required_keys_rejected(self):
        d = copy.deepcopy(self.BASE_DESIGN)
        del d['zone_1']['elements'][0]['width']
        errors = validate_design_data_schema(d)
        self.assertTrue(any('missing required key' in e for e in errors), errors)

    def test_zone_1_element_non_numeric_position_rejected(self):
        d = copy.deepcopy(self.BASE_DESIGN)
        d['zone_1']['elements'][0]['x'] = 'twenty'
        errors = validate_design_data_schema(d)
        self.assertTrue(any('must be a number' in e for e in errors), errors)

    def test_zone_1_element_zero_or_negative_dimensions_rejected(self):
        d = copy.deepcopy(self.BASE_DESIGN)
        d['zone_1']['elements'][0]['width'] = 0
        errors = validate_design_data_schema(d)
        self.assertTrue(any('greater than zero' in e for e in errors), errors)

    def test_zone_2_element_negative_spacing_rejected(self):
        d = copy.deepcopy(self.BASE_DESIGN)
        d['zone_2']['elements'][0]['spacing_after_previous'] = -5
        errors = validate_design_data_schema(d)
        self.assertTrue(any('spacing_after_previous' in e for e in errors), errors)

    def test_style_must_be_a_dict(self):
        d = copy.deepcopy(self.BASE_DESIGN)
        d['zone_1']['elements'][0]['style'] = 'not a dict'
        errors = validate_design_data_schema(d)
        self.assertTrue(any('style must be an object' in e for e in errors), errors)


# ══════════════════════════════════════════════════════════════════
# SEED DECOMPOSITION — dogfooding the validator against real data
# ══════════════════════════════════════════════════════════════════

class SeedDataValidationTests(InvoicesAPITestCase):
    def test_all_three_builtin_designs_pass_real_validation(self):
        for name, data in BUILTIN_DESIGNS.items():
            errors = validate_design_data_schema(data)
            self.assertEqual(errors, [], f'{name}: {errors}')

    def test_all_three_builtin_designs_have_mandatory_elements(self):
        for name, data in BUILTIN_DESIGNS.items():
            self.assertIn('table', data['zone_2'], name)
            types = [e['type'] for e in data['zone_2']['elements']]
            self.assertIn('totals', types, name)

    def test_get_builtin_design_data_returns_independent_deep_copy(self):
        a = get_builtin_design_data('professional')
        b = get_builtin_design_data('professional')
        a['zone_1']['elements'][0]['x'] = 999
        self.assertNotEqual(a['zone_1']['elements'][0]['x'], b['zone_1']['elements'][0]['x'])
        # And the real module-level constant itself must be untouched.
        self.assertNotEqual(BUILTIN_DESIGNS['professional']['zone_1']['elements'][0]['x'], 999)


# ══════════════════════════════════════════════════════════════════
# CRUD + ALLOWLIST + CROSS-USER ISOLATION
# ══════════════════════════════════════════════════════════════════

class DesignCRUDTests(InvoicesAPITestCase):
    def _valid_payload(self, **overrides):
        payload = {
            'name': 'My Custom Design',
            'base_template': 'professional',
            'design_data': copy.deepcopy(BUILTIN_DESIGNS['professional']),
        }
        payload.update(overrides)
        return payload

    def test_create_design_with_valid_design_data(self):
        resp = self._post(reverse('invoices:design_list'), self._valid_payload())
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body['name'], 'My Custom Design')
        self.assertEqual(body['source'], 'custom')  # serializer default, not the model's own 'builtin' default

    def test_create_design_rejects_invalid_design_data_with_specific_errors(self):
        payload = self._valid_payload()
        del payload['design_data']['zone_2']['table']
        resp = self._post(reverse('invoices:design_list'), payload)
        self.assertEqual(resp.status_code, 400)
        errors = resp.json()['design_data']
        self.assertTrue(any('zone_2.table' in e for e in errors), errors)

    def test_create_design_rejects_blank_name(self):
        resp = self._post(reverse('invoices:design_list'), self._valid_payload(name='   '))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('name', resp.json())

    def test_list_designs_scoped_to_requesting_user(self):
        InvoiceDesign.objects.create(
            user=self.user, name='Mine', base_template='professional',
            design_data=copy.deepcopy(BUILTIN_DESIGNS['professional']),
        )
        other = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        InvoiceDesign.objects.create(
            user=other, name='Not Mine', base_template='minimal',
            design_data=copy.deepcopy(BUILTIN_DESIGNS['minimal']),
        )
        resp = self._get(reverse('invoices:design_list'))
        names = [d['name'] for d in resp.json()]
        self.assertEqual(names, ['Mine'])

    def test_detail_get_put_delete(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='Original', base_template='professional',
            design_data=copy.deepcopy(BUILTIN_DESIGNS['professional']),
        )
        url = reverse('invoices:design_detail', kwargs={'pk': design.pk})

        resp = self._get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['name'], 'Original')

        resp = self._put(url, self._valid_payload(name='Renamed'))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['name'], 'Renamed')

        resp = self._delete(url)
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(InvoiceDesign.objects.filter(pk=design.pk).exists())

    def test_cannot_access_another_users_design(self):
        other = User.objects.create_user(email='other2@example.com', password='Sup3r$ecret1')
        design = InvoiceDesign.objects.create(
            user=other, name='Theirs', base_template='minimal',
            design_data=copy.deepcopy(BUILTIN_DESIGNS['minimal']),
        )
        url = reverse('invoices:design_detail', kwargs={'pk': design.pk})
        self.assertEqual(self._get(url).status_code, 404)
        self.assertEqual(self._put(url, self._valid_payload()).status_code, 404)
        self.assertEqual(self._delete(url).status_code, 404)

    def test_allowlist_regression_id_and_user_cannot_be_client_supplied(self):
        """
        Explicit allowlist means `id`/`user`/`created_at` in the payload are either
        read-only or simply absent from `fields` — a client can't hijack ownership
        or an existing row's identity through them.
        """
        payload = self._valid_payload(id='11111111-1111-1111-1111-111111111111')
        resp = self._post(reverse('invoices:design_list'), payload)
        self.assertEqual(resp.status_code, 201, resp.content)
        design = InvoiceDesign.objects.get(pk=resp.json()['id'])
        self.assertNotEqual(str(design.pk), '11111111-1111-1111-1111-111111111111')
        self.assertEqual(design.user, self.user)


# ══════════════════════════════════════════════════════════════════
# SET-DEFAULT UNIQUENESS
# ══════════════════════════════════════════════════════════════════

class DesignSetDefaultTests(InvoicesAPITestCase):
    def test_only_one_default_per_user(self):
        d1 = InvoiceDesign.objects.create(
            user=self.user, name='D1', base_template='professional', is_default=True,
            design_data=copy.deepcopy(BUILTIN_DESIGNS['professional']),
        )
        d2 = InvoiceDesign.objects.create(
            user=self.user, name='D2', base_template='minimal',
            design_data=copy.deepcopy(BUILTIN_DESIGNS['minimal']),
        )
        resp = self._post(reverse('invoices:design_set_default', kwargs={'pk': d2.pk}))
        self.assertEqual(resp.status_code, 200)

        d1.refresh_from_db()
        d2.refresh_from_db()
        self.assertFalse(d1.is_default)
        self.assertTrue(d2.is_default)
        self.assertEqual(InvoiceDesign.objects.filter(user=self.user, is_default=True).count(), 1)

    def test_set_default_scoped_to_requesting_user_only(self):
        """Setting a default for user A must never touch user B's own default."""
        other = User.objects.create_user(email='other3@example.com', password='Sup3r$ecret1')
        other_default = InvoiceDesign.objects.create(
            user=other, name='Other default', base_template='professional', is_default=True,
            design_data=copy.deepcopy(BUILTIN_DESIGNS['professional']),
        )
        mine = InvoiceDesign.objects.create(
            user=self.user, name='Mine', base_template='minimal',
            design_data=copy.deepcopy(BUILTIN_DESIGNS['minimal']),
        )
        resp = self._post(reverse('invoices:design_set_default', kwargs={'pk': mine.pk}))
        self.assertEqual(resp.status_code, 200)

        other_default.refresh_from_db()
        self.assertTrue(other_default.is_default)


# ══════════════════════════════════════════════════════════════════
# DUPLICATE (Path 1 — instantiate a builtin seed as a real owned row)
# ══════════════════════════════════════════════════════════════════

class DesignDuplicateTests(InvoicesAPITestCase):
    def test_duplicate_creates_real_owned_row_from_seed(self):
        resp = self._post(reverse('invoices:design_duplicate'), {'base_template': 'modern'})
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body['base_template'], 'modern')
        self.assertEqual(body['source'], 'builtin')

        design = InvoiceDesign.objects.get(pk=body['id'])
        self.assertEqual(design.user, self.user)
        self.assertEqual(validate_design_data_schema(design.design_data), [])

    def test_duplicate_is_independent_of_the_seed_constant(self):
        """Editing the duplicated row's design_data must never mutate the shared BUILTIN_DESIGNS dict."""
        resp = self._post(reverse('invoices:design_duplicate'), {'base_template': 'professional'})
        design = InvoiceDesign.objects.get(pk=resp.json()['id'])
        design.design_data['zone_1']['elements'][0]['x'] = 12345
        design.save()
        self.assertNotEqual(BUILTIN_DESIGNS['professional']['zone_1']['elements'][0]['x'], 12345)

    def test_duplicate_rejects_unknown_base_template(self):
        resp = self._post(reverse('invoices:design_duplicate'), {'base_template': 'nonexistent'})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('base_template', resp.json())

    def test_duplicate_accepts_optional_color_variant_and_name(self):
        resp = self._post(reverse('invoices:design_duplicate'), {
            'base_template': 'minimal', 'color_variant': 'sage', 'name': 'My Sage Minimal',
        })
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body['color_variant'], 'sage')
        self.assertEqual(body['name'], 'My Sage Minimal')

    def test_duplicate_defaults_name_when_not_supplied(self):
        resp = self._post(reverse('invoices:design_duplicate'), {'base_template': 'professional'})
        self.assertEqual(resp.json()['name'], 'Professional (copy)')


# ══════════════════════════════════════════════════════════════════
# RATE LIMITING
# ══════════════════════════════════════════════════════════════════

class DesignRateLimitTests(InvoicesAPITestCase):
    def _drain(self, action_key):
        cache.set(f'ratelimit_invoices_{action_key}_{self.user.pk}', 30, timeout=3600)

    def _valid_payload(self):
        return {
            'name': 'X', 'base_template': 'professional',
            'design_data': copy.deepcopy(BUILTIN_DESIGNS['professional']),
        }

    def test_create_rate_limited(self):
        self._drain('design_create')
        resp = self._post(reverse('invoices:design_list'), self._valid_payload())
        self.assertEqual(resp.status_code, 429)

    def test_update_rate_limited(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='D', base_template='professional',
            design_data=copy.deepcopy(BUILTIN_DESIGNS['professional']),
        )
        self._drain('design_update')
        resp = self._put(reverse('invoices:design_detail', kwargs={'pk': design.pk}), self._valid_payload())
        self.assertEqual(resp.status_code, 429)

    def test_delete_rate_limited(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='D', base_template='professional',
            design_data=copy.deepcopy(BUILTIN_DESIGNS['professional']),
        )
        self._drain('design_delete')
        resp = self._delete(reverse('invoices:design_detail', kwargs={'pk': design.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_set_default_rate_limited(self):
        design = InvoiceDesign.objects.create(
            user=self.user, name='D', base_template='professional',
            design_data=copy.deepcopy(BUILTIN_DESIGNS['professional']),
        )
        self._drain('design_set_default')
        resp = self._post(reverse('invoices:design_set_default', kwargs={'pk': design.pk}))
        self.assertEqual(resp.status_code, 429)

    def test_duplicate_rate_limited(self):
        self._drain('design_duplicate')
        resp = self._post(reverse('invoices:design_duplicate'), {'base_template': 'professional'})
        self.assertEqual(resp.status_code, 429)
