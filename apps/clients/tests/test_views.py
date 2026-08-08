# apps/clients/tests/test_views.py
import json

from django.core.cache import cache
from django.middleware.csrf import get_token
from django.test import Client as DjangoTestClient
from django.test import RequestFactory, TestCase
from django.urls import reverse

from apps.clients.models import Client as ClientModel
from apps.clients.models import ClientTag
from apps.users.models import User


class ClientsAPITestCase(TestCase):
    """
    Shared login/CSRF plumbing, mirroring apps/users/tests/test_sessions.py's
    established pattern: Client(enforce_csrf_checks=True), a real login
    through the actual endpoint (not Django's session auth, which this
    project's cookie-JWT auth doesn't use), and a fresh CSRF token per
    mutating request.
    """
    def setUp(self):
        cache.clear()
        self.rf = RequestFactory()
        self.client = DjangoTestClient(enforce_csrf_checks=True)
        self.user = User.objects.create_user(email='freelancer@example.com', password='Sup3r$ecret1')
        self.user.is_email_verified = True
        self.user.is_active = True
        self.user.save()
        self._login()

    def _csrf_token(self):
        dummy = self.rf.get('/')
        token = get_token(dummy)
        self.client.cookies['csrftoken'] = dummy.META['CSRF_COOKIE']
        return token

    def _login(self, email='freelancer@example.com', password='Sup3r$ecret1'):
        csrf_token = self._csrf_token()
        resp = self.client.post(reverse('users:login'), data=json.dumps({
            'login': email, 'password': password,
        }), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token)
        assert resp.status_code == 200, resp.content

    def _get(self, url):
        return self.client.get(url)

    def _post(self, url, data=None):
        csrf_token = self._csrf_token()
        return self.client.post(
            url, data=json.dumps(data or {}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )

    def _put(self, url, data=None):
        csrf_token = self._csrf_token()
        return self.client.put(
            url, data=json.dumps(data or {}), content_type='application/json', HTTP_X_CSRFTOKEN=csrf_token,
        )

    def _delete(self, url):
        csrf_token = self._csrf_token()
        return self.client.delete(url, HTTP_X_CSRFTOKEN=csrf_token)

    def _create_client(self, **overrides):
        data = {'name': 'Acme Co', 'email': 'acme@example.com'}
        data.update(overrides)
        resp = self._post(reverse('clients:client_list'), data)
        assert resp.status_code == 201, resp.content
        return resp.json()


class ClientCRUDTests(ClientsAPITestCase):
    def test_create_client_success(self):
        resp = self._post(reverse('clients:client_list'), {
            'name': 'Acme Co', 'email': 'acme@example.com', 'company': 'Acme Corp',
        })
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertEqual(body['name'], 'Acme Co')
        self.assertTrue(body['portal_token'])
        self.assertTrue(body['is_active'])
        self.assertEqual(ClientModel.objects.get(pk=body['id']).user, self.user)

    def test_create_client_missing_name_fails(self):
        resp = self._post(reverse('clients:client_list'), {'email': 'acme@example.com'})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('name', resp.json())

    def test_create_client_mass_assignment_of_user_field_is_ignored(self):
        """
        The exact category of test that would have caught the v1-style
        FreelancerProfileSerializer vulnerability: an attacker-controlled
        'user' key in the payload must never override who actually owns
        the created row.
        """
        other_user = User.objects.create_user(email='victim@example.com', password='Sup3r$ecret1')
        resp = self._post(reverse('clients:client_list'), {
            'name': 'Acme Co', 'email': 'acme@example.com', 'user': str(other_user.pk),
        })
        self.assertEqual(resp.status_code, 201)
        created = ClientModel.objects.get(pk=resp.json()['id'])
        self.assertEqual(created.user, self.user)
        self.assertNotEqual(created.user, other_user)

    def test_create_client_cannot_set_moderation_fields_directly(self):
        """is_active/is_flagged/portal_token aren't on the write serializer at all — attempting to set them through create must have no effect."""
        resp = self._post(reverse('clients:client_list'), {
            'name': 'Acme Co', 'email': 'acme@example.com',
            'is_active': False, 'is_flagged': True, 'portal_token': 'attacker-chosen-token',
        })
        self.assertEqual(resp.status_code, 201)
        created = ClientModel.objects.get(pk=resp.json()['id'])
        self.assertTrue(created.is_active)
        self.assertFalse(created.is_flagged)
        self.assertNotEqual(created.portal_token, 'attacker-chosen-token')

    def test_get_client_detail(self):
        created = self._create_client()
        resp = self._get(reverse('clients:client_detail', kwargs={'pk': created['id']}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['id'], created['id'])

    def test_update_client(self):
        created = self._create_client()
        resp = self._put(reverse('clients:client_detail', kwargs={'pk': created['id']}), {
            'name': 'Acme Renamed', 'email': 'acme@example.com',
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['name'], 'Acme Renamed')

    def test_update_client_cannot_change_owner(self):
        other_user = User.objects.create_user(email='other@example.com', password='Sup3r$ecret1')
        created = self._create_client()
        resp = self._put(reverse('clients:client_detail', kwargs={'pk': created['id']}), {
            'name': 'Acme Co', 'email': 'acme@example.com', 'user': str(other_user.pk),
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(ClientModel.objects.get(pk=created['id']).user, self.user)

    def test_cannot_access_another_users_client(self):
        other_user = User.objects.create_user(email='other2@example.com', password='Sup3r$ecret1')
        other_client = ClientModel.objects.create(user=other_user, name='Not Yours', email='x@example.com')
        resp = self._get(reverse('clients:client_detail', kwargs={'pk': other_client.pk}))
        self.assertEqual(resp.status_code, 404)


class ClientFilterSearchSortTests(ClientsAPITestCase):
    def setUp(self):
        super().setUp()
        self.active = self._create_client(name='Alpha', email='alpha@example.com', company='Alpha Inc')
        self.flagged = self._create_client(name='Beta', email='beta@example.com', company='Beta LLC')
        self._post(reverse('clients:client_flag', kwargs={'pk': self.flagged['id']}), {
            'flag_type': 'other', 'flag_reason': 'Late payer.',
        })
        self.archived = self._create_client(name='Gamma', email='gamma@example.com', company='Gamma Ltd')
        self._post(reverse('clients:client_archive', kwargs={'pk': self.archived['id']}))

    def test_default_filter_is_active_only(self):
        resp = self._get(reverse('clients:client_list'))
        names = {c['name'] for c in resp.json()['results']}
        self.assertIn('Alpha', names)
        self.assertIn('Beta', names)  # flagged clients are still active
        self.assertNotIn('Gamma', names)  # archived excluded from the default view

    def test_filter_archived(self):
        resp = self._get(reverse('clients:client_list') + '?filter=archived')
        names = {c['name'] for c in resp.json()['results']}
        self.assertEqual(names, {'Gamma'})

    def test_filter_flagged(self):
        resp = self._get(reverse('clients:client_list') + '?filter=flagged')
        names = {c['name'] for c in resp.json()['results']}
        self.assertEqual(names, {'Beta'})

    def test_filter_all_includes_archived(self):
        resp = self._get(reverse('clients:client_list') + '?filter=all')
        names = {c['name'] for c in resp.json()['results']}
        self.assertEqual(names, {'Alpha', 'Beta', 'Gamma'})

    def test_filter_with_overdue_is_empty_since_invoices_do_not_exist_yet(self):
        resp = self._get(reverse('clients:client_list') + '?filter=with_overdue')
        self.assertEqual(resp.json()['results'], [])
        self.assertEqual(resp.json()['total'], 0)

    def test_search_by_name(self):
        resp = self._get(reverse('clients:client_list') + '?filter=all&search=Alpha')
        names = {c['name'] for c in resp.json()['results']}
        self.assertEqual(names, {'Alpha'})

    def test_search_by_company(self):
        resp = self._get(reverse('clients:client_list') + '?filter=all&search=Beta LLC')
        names = {c['name'] for c in resp.json()['results']}
        self.assertEqual(names, {'Beta'})

    def test_sort_name_is_alphabetical(self):
        resp = self._get(reverse('clients:client_list') + '?filter=all&sort=name')
        names = [c['name'] for c in resp.json()['results']]
        self.assertEqual(names, sorted(names))

    def test_sort_total_invoiced_falls_back_to_name_without_error(self):
        """apps.invoices doesn't exist yet — this must degrade gracefully, not 500."""
        resp = self._get(reverse('clients:client_list') + '?filter=all&sort=total_invoiced')
        self.assertEqual(resp.status_code, 200)
        names = [c['name'] for c in resp.json()['results']]
        self.assertEqual(names, sorted(names))

    def test_sort_overdue_falls_back_to_name_without_error(self):
        resp = self._get(reverse('clients:client_list') + '?filter=all&sort=overdue')
        self.assertEqual(resp.status_code, 200)
        names = [c['name'] for c in resp.json()['results']]
        self.assertEqual(names, sorted(names))


class ArchiveRestoreFlagTests(ClientsAPITestCase):
    def test_archive_then_double_archive_fails(self):
        created = self._create_client()
        resp = self._post(reverse('clients:client_archive', kwargs={'pk': created['id']}))
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['is_active'])

        resp = self._post(reverse('clients:client_archive', kwargs={'pk': created['id']}))
        self.assertEqual(resp.status_code, 400)

    def test_restore_then_double_restore_fails(self):
        created = self._create_client()
        self._post(reverse('clients:client_archive', kwargs={'pk': created['id']}))

        resp = self._post(reverse('clients:client_restore', kwargs={'pk': created['id']}))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['is_active'])

        resp = self._post(reverse('clients:client_restore', kwargs={'pk': created['id']}))
        self.assertEqual(resp.status_code, 400)

    def test_flag_requires_a_reason(self):
        created = self._create_client()
        resp = self._post(reverse('clients:client_flag', kwargs={'pk': created['id']}), {'flag_type': 'other'})
        self.assertEqual(resp.status_code, 400)

    def test_flag_rejects_invalid_flag_type(self):
        created = self._create_client()
        resp = self._post(reverse('clients:client_flag', kwargs={'pk': created['id']}), {
            'flag_type': 'not_a_real_type', 'flag_reason': 'Something happened.',
        })
        self.assertEqual(resp.status_code, 400)

    def test_flag_success(self):
        created = self._create_client()
        resp = self._post(reverse('clients:client_flag', kwargs={'pk': created['id']}), {
            'flag_type': 'payment_risk', 'flag_reason': 'Paid 90 days late twice.',
        })
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['is_flagged'])
        self.assertEqual(body['flag_type'], 'payment_risk')
        self.assertIsNotNone(body['flagged_at'])

    def test_flag_clear(self):
        created = self._create_client()
        self._post(reverse('clients:client_flag', kwargs={'pk': created['id']}), {
            'flag_type': 'other', 'flag_reason': 'Test.',
        })
        resp = self._post(reverse('clients:client_flag', kwargs={'pk': created['id']}), {'clear': True})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertFalse(body['is_flagged'])
        self.assertIsNone(body['flagged_at'])


class NotesTests(ClientsAPITestCase):
    def test_create_and_list_notes(self):
        created = self._create_client()
        resp = self._post(reverse('clients:client_notes', kwargs={'pk': created['id']}), {
            'content': 'Called about overdue invoice.',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['author_email'], 'freelancer@example.com')

        resp = self._get(reverse('clients:client_notes', kwargs={'pk': created['id']}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)

    def test_create_note_rejects_empty_content(self):
        created = self._create_client()
        resp = self._post(reverse('clients:client_notes', kwargs={'pk': created['id']}), {'content': '   '})
        self.assertEqual(resp.status_code, 400)

    def test_delete_note(self):
        created = self._create_client()
        note_resp = self._post(reverse('clients:client_notes', kwargs={'pk': created['id']}), {'content': 'Note.'})
        note_id = note_resp.json()['id']

        resp = self._delete(reverse('clients:client_note_delete', kwargs={'pk': created['id'], 'note_id': note_id}))
        self.assertEqual(resp.status_code, 204)

        resp = self._get(reverse('clients:client_notes', kwargs={'pk': created['id']}))
        self.assertEqual(resp.json(), [])

    def test_delete_note_from_wrong_client_404s(self):
        client_a = self._create_client(name='A', email='a@example.com')
        client_b = self._create_client(name='B', email='b@example.com')
        note_resp = self._post(reverse('clients:client_notes', kwargs={'pk': client_a['id']}), {'content': 'Note.'})
        note_id = note_resp.json()['id']

        resp = self._delete(reverse('clients:client_note_delete', kwargs={'pk': client_b['id'], 'note_id': note_id}))
        self.assertEqual(resp.status_code, 404)


class TagsTests(ClientsAPITestCase):
    def test_create_and_list_tags(self):
        resp = self._post(reverse('clients:client_tags'), {'name': 'VIP', 'color': '#3B82F6'})
        self.assertEqual(resp.status_code, 201)

        resp = self._get(reverse('clients:client_tags'))
        self.assertEqual(len(resp.json()), 1)
        self.assertEqual(resp.json()[0]['name'], 'VIP')

    def test_create_duplicate_tag_name_fails(self):
        self._post(reverse('clients:client_tags'), {'name': 'VIP', 'color': '#3B82F6'})
        resp = self._post(reverse('clients:client_tags'), {'name': 'VIP', 'color': '#FF0000'})
        self.assertEqual(resp.status_code, 400)

    def test_create_tag_rejects_invalid_color(self):
        resp = self._post(reverse('clients:client_tags'), {'name': 'VIP', 'color': 'not-a-color'})
        self.assertEqual(resp.status_code, 400)

    def test_attach_and_detach_tag(self):
        created = self._create_client()
        tag_resp = self._post(reverse('clients:client_tags'), {'name': 'VIP', 'color': '#3B82F6'})
        tag_id = tag_resp.json()['id']

        resp = self._post(reverse('clients:client_tag_attach', kwargs={'pk': created['id'], 'tag_id': tag_id}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()['tags']), 1)

        resp = self._delete(reverse('clients:client_tag_detach', kwargs={'pk': created['id'], 'tag_id': tag_id}))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()['tags']), 0)

        # Detaching never deletes the tag itself.
        self.assertTrue(ClientTag.objects.filter(pk=tag_id).exists())

    def test_attach_nonexistent_tag_404s(self):
        created = self._create_client()
        resp = self._post(reverse('clients:client_tag_attach', kwargs={
            'pk': created['id'], 'tag_id': '00000000-0000-0000-0000-000000000000',
        }))
        self.assertEqual(resp.status_code, 404)

    def test_cannot_attach_another_users_tag(self):
        other_user = User.objects.create_user(email='tagowner@example.com', password='Sup3r$ecret1')
        other_tag = ClientTag.objects.create(user=other_user, name='Theirs', color='#000000')
        created = self._create_client()
        resp = self._post(reverse('clients:client_tag_attach', kwargs={'pk': created['id'], 'tag_id': other_tag.pk}))
        self.assertEqual(resp.status_code, 404)


class AnalyticsTests(ClientsAPITestCase):
    def test_analytics_shape_before_invoices_exist(self):
        created = self._create_client()
        resp = self._get(reverse('clients:client_analytics', kwargs={'pk': created['id']}))
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIsNone(body['reliability_score'])
        self.assertEqual(body['invoice_count'], 0)
        self.assertIn('reliability_breakdown', body)


class RateLimitTests(ClientsAPITestCase):
    def test_create_client_rate_limited_after_thirty_per_hour(self):
        for i in range(30):
            resp = self._post(reverse('clients:client_list'), {'name': f'Client {i}', 'email': f'c{i}@example.com'})
            self.assertEqual(resp.status_code, 201)

        resp = self._post(reverse('clients:client_list'), {'name': 'One Too Many', 'email': 'toomany@example.com'})
        self.assertEqual(resp.status_code, 429)

    def test_archive_rate_limited_after_thirty_per_hour(self):
        # Created directly via the ORM, not the create endpoint — this
        # test is about the archive action's own budget, and routing 31
        # creates through client_create would hit ITS 30/hour limit first.
        clients = [
            ClientModel.objects.create(user=self.user, name=f'C{i}', email=f'c{i}@example.com')
            for i in range(31)
        ]
        for c in clients[:30]:
            resp = self._post(reverse('clients:client_archive', kwargs={'pk': c.pk}))
            self.assertEqual(resp.status_code, 200)

        resp = self._post(reverse('clients:client_archive', kwargs={'pk': clients[30].pk}))
        self.assertEqual(resp.status_code, 429)
