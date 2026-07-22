# config/urls.py
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('apps.users.urls')),
    # Future modules add their own include() here as they're built:
    # path('api/invoices/', include('apps.invoices.urls')),
    # path('api/payments/', include('apps.payments.urls')),
    # etc.
]

if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)