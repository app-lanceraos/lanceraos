# deploy/test-seed.py
#
# Creates throwaway test data for the TEST stack only (never run against the real one): one user, one
# client and 12 finalised invoices across different templates. It goes through the application's own
# code path - DRF's APIClient -> real URL routing -> the real invoice_create and invoice_finalise views -
# so each finalise really queues render_and_store_invoice_pdf, exactly like a user clicking "Finalise".
# No application source is modified; this file is only input to the Django shell.
#
# Not part of the image (deploy/ is in .dockerignore); feed it on stdin:
#   docker compose -f deploy/docker-compose.yml --env-file deploy/.env.test exec -T web \
#       python manage.py shell < deploy/test-seed.py
# Throwaway test data, created ONLY through the app's own HTTP view code path
# (DRF APIClient -> real URL routing -> real invoice_create / invoice_finalise).
from datetime import date, timedelta
from rest_framework.test import APIClient
from apps.users.models import User
from apps.clients.models import Client
from apps.invoices.models import Invoice
from apps.invoices.template_manifest import selectable_templates

user, _ = User.objects.get_or_create(email='deploytest@example.com', defaults={'username': 'deploytest'})
user.set_password('Throwaway-pass-123!'); user.save()
p = user.profile
p.business_name = 'Deploy Test Studio'; p.display_name = 'Deploy Test Studio'; p.save()
client_obj, _ = Client.objects.get_or_create(user=user, email='client@example.com', defaults={'name': 'Test Client', 'default_currency': 'USD'})

api = APIClient()
api.force_authenticate(user=user)
api.defaults['HTTP_HOST'] = 'localhost'
api.defaults['HTTP_X_FORWARDED_PROTO'] = 'https'   # act like the platform proxy

keys = [t['key'] for t in selectable_templates()]
made = []
for i in range(12):
    p.invoice_template = keys[i * 2 % len(keys)]; p.save(update_fields=['invoice_template'])
    r = api.post('/api/invoices/', {
        'client': str(client_obj.pk), 'client_name': 'Test Client', 'client_email': 'client@example.com',
        'currency': 'USD', 'issue_date': str(date.today() - timedelta(days=1)), 'due_date': str(date.today() + timedelta(days=14)),
        'items': [{'description': f'Service item {n}', 'quantity': '2', 'unit_price': '150.00'} for n in range(1, 4 + i)],
    }, format='json')
    assert r.status_code == 201, (r.status_code, r.data)
    f = api.post(f"/api/invoices/{r.data['id']}/finalise/", format='json')
    assert f.status_code == 200, (f.status_code, f.data)
    made.append((f.data['invoice_number'], f.data['status']))
print('created+finalised via API:', len(made), made[:3], '...')
print('db finalised count:', Invoice.objects.exclude(status='draft').filter(user=user).count())
