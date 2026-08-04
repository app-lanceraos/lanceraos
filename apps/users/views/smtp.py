# apps/users/views/smtp.py
import ipaddress
import logging
import smtplib
import socket
import ssl

from django.core.cache import cache
from django.core.mail import EmailMultiAlternatives, get_connection
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.encryption import encrypt_field
from core.observability import log_event

from ..models import FreelancerProfile

logger = logging.getLogger(__name__)

SMTP_UPDATE_FIELDS = [
    'custom_smtp_enabled', 'custom_smtp_host', 'custom_smtp_port',
    'custom_smtp_username', 'custom_smtp_password', 'custom_smtp_use_tls',
    'custom_smtp_use_ssl', 'custom_smtp_from_name',
    'custom_smtp_verified', 'custom_smtp_verified_at',
]


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def save_custom_smtp(request):
    """
    Saves and verifies custom SMTP settings by actually sending a test
    email through the user's OWN mail server before persisting anything.
    Deliberately uses Django's raw SMTP backend directly rather than
    core.email.send_email() — the whole point here is to exercise the
    user's SMTP server as a client would, which is categorically
    different from LanceraOS sending one of its own platform emails.
    """
    user = request.user

    key = f'smtp_save_{request.user.pk}'
    count = cache.get(key, 0)
    if count >= 5:
        return Response({'error': 'Too many attempts. Please try again in an hour.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    cache.set(key, count + 1, timeout=3600)

    data = request.data

    host = (data.get('host') or '').strip()
    port_raw = data.get('port')
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    use_tls = bool(data.get('use_tls', False))
    use_ssl = bool(data.get('use_ssl', True))
    from_name = (data.get('from_name') or '').strip()

    errors = {}
    if not host:
        errors['host'] = 'SMTP host is required.'
    if not username:
        errors['username'] = 'SMTP username is required.'
    if not password:
        errors['password'] = 'SMTP password is required.'
    try:
        port = int(port_raw)
        if not (1 <= port <= 65535):
            raise ValueError
    except (TypeError, ValueError):
        errors['port'] = 'Port must be a number between 1 and 65535.'
    if use_tls and use_ssl:
        errors['use_tls'] = 'Cannot enable both TLS and SSL at the same time.'

    if errors:
        return Response(errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        resolved_ip = ipaddress.ip_address(socket.gethostbyname(host))
    except socket.gaierror:
        return Response({'host': 'Could not resolve that hostname.'}, status=status.HTTP_400_BAD_REQUEST)

    if resolved_ip.is_private or resolved_ip.is_loopback or resolved_ip.is_link_local:
        return Response(
            {'host': 'That host is not reachable from LanceraOS.'}, status=status.HTTP_400_BAD_REQUEST
        )

    try:
        conn = get_connection(
            backend='django.core.mail.backends.smtp.EmailBackend',
            host=host, port=port, username=username, password=password,
            use_tls=use_tls, use_ssl=use_ssl, fail_silently=False, timeout=15,
        )
        display = from_name or user.get_full_name() or user.username
        msg = EmailMultiAlternatives(
            subject='LanceraOS — Custom SMTP Test',
            body=(
                f'Hi {user.first_name or user.username},\n\n'
                f'Your custom SMTP settings have been verified successfully. '
                f'Invoice emails will now be sent through your mail server.\n\n'
                f'LanceraOS · lanceraos.com'
            ),
            from_email=f'{display} <{username}>',
            to=[user.email],
            connection=conn,
        )
        msg.send(fail_silently=False)
    except smtplib.SMTPAuthenticationError:
        return Response(
            {'error': 'Authentication failed — check your username and password.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except smtplib.SMTPConnectError:
        return Response({'error': 'Could not connect to that host.'}, status=status.HTTP_400_BAD_REQUEST)
    except socket.timeout:
        return Response({'error': 'Connection timed out.'}, status=status.HTTP_400_BAD_REQUEST)
    except socket.gaierror:
        return Response({'error': 'Could not resolve that hostname.'}, status=status.HTTP_400_BAD_REQUEST)
    except ssl.SSLError:
        return Response(
            {'error': 'SSL/TLS error connecting to that host.'}, status=status.HTTP_400_BAD_REQUEST
        )
    except Exception:
        logger.exception('Custom SMTP test connection failed for user_id=%s host=%s', user.pk, host)
        return Response(
            {'error': 'Connection failed. Please check your settings and try again.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        prof = user.profile
    except FreelancerProfile.DoesNotExist:
        return Response({'error': 'Profile not found.'}, status=status.HTTP_404_NOT_FOUND)

    prof.custom_smtp_enabled = True
    prof.custom_smtp_host = host
    prof.custom_smtp_port = port
    prof.custom_smtp_username = username
    prof.custom_smtp_password = encrypt_field(password)
    prof.custom_smtp_use_tls = use_tls
    prof.custom_smtp_use_ssl = use_ssl
    prof.custom_smtp_from_name = from_name
    prof.custom_smtp_verified = True
    prof.custom_smtp_verified_at = timezone.now()
    prof.save(update_fields=SMTP_UPDATE_FIELDS)

    log_event('custom_smtp_saved', user=user, request=request)

    return Response({
        'message': 'Custom SMTP verified and saved. A test email was sent to your address.',
        'host': host, 'port': port, 'username': username, 'from_name': from_name,
        'use_tls': use_tls, 'use_ssl': use_ssl, 'verified': True,
        'verified_at': prof.custom_smtp_verified_at.isoformat(),
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def disable_custom_smtp(request):
    """Clears all custom SMTP settings and reverts to the default Resend sending path."""
    try:
        prof = request.user.profile
    except FreelancerProfile.DoesNotExist:
        return Response({'error': 'Profile not found.'}, status=status.HTTP_404_NOT_FOUND)

    prof.custom_smtp_enabled = False
    prof.custom_smtp_host = ''
    prof.custom_smtp_port = 587
    prof.custom_smtp_username = ''
    prof.custom_smtp_password = ''
    prof.custom_smtp_use_tls = True
    prof.custom_smtp_use_ssl = False
    prof.custom_smtp_from_name = ''
    prof.custom_smtp_verified = False
    prof.custom_smtp_verified_at = None
    prof.save(update_fields=SMTP_UPDATE_FIELDS)

    log_event('custom_smtp_disabled', user=request.user, request=request)
    return Response({'message': 'Custom SMTP disabled. LanceraOS default mail is now active.'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def smtp_status(request):
    """Current SMTP configuration and verification status. The password is never included, ever."""
    try:
        prof = request.user.profile
    except FreelancerProfile.DoesNotExist:
        return Response({'custom_smtp_enabled': False, 'custom_smtp_verified': False})

    if not prof.custom_smtp_enabled:
        return Response({'custom_smtp_enabled': False, 'custom_smtp_verified': False})

    return Response({
        'custom_smtp_enabled': prof.custom_smtp_enabled,
        'custom_smtp_verified': prof.custom_smtp_verified,
        'custom_smtp_verified_at': (
            prof.custom_smtp_verified_at.isoformat() if prof.custom_smtp_verified_at else None
        ),
        'host': prof.custom_smtp_host,
        'port': prof.custom_smtp_port,
        'username': prof.custom_smtp_username,
        'from_name': prof.custom_smtp_from_name,
        'use_tls': prof.custom_smtp_use_tls,
        'use_ssl': prof.custom_smtp_use_ssl,
    })