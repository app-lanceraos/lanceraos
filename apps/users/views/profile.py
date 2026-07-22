# apps/users/views/profile.py
import os

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.observability import log_event

from ..models import FreelancerProfile
from ..serializers import AccountUpdateSerializer, FreelancerProfileSerializer, UserSerializer

ALLOWED_LOGO_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.svg'}
MAX_LOGO_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB

# Security Alerts has no entry here, deliberately — CLAUDE.md requires it
# can never be disabled, so there is simply no field for it to toggle.
NOTIFICATION_FIELDS = ['notif_invoice_events', 'notif_client_messages', 'notif_payments']


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me(request):
    """Lightweight endpoint the frontend polls on app load to check auth state."""
    return Response(UserSerializer(request.user).data)


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def profile(request):
    try:
        prof = request.user.profile
    except Exception:
        return Response({'error': 'Profile not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(FreelancerProfileSerializer(prof).data)

    serializer = FreelancerProfileSerializer(prof, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    log_event('profile_updated', user=request.user, request=request)
    return Response(serializer.data)


@api_view(['PUT'])
@permission_classes([IsAuthenticated])
def update_account(request):
    serializer = AccountUpdateSerializer(request.user, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    log_event('account_updated', user=request.user, request=request)
    return Response(UserSerializer(request.user).data)


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def notification_settings(request):
    """
    Dedicated Notifications-tab endpoint, distinct from the general
    profile PUT — lets the frontend read/write just these three toggles
    without round-tripping the entire profile object every time someone
    flips a switch on this one tab.
    """
    try:
        prof = request.user.profile
    except FreelancerProfile.DoesNotExist:
        return Response({'error': 'Profile not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response({field: getattr(prof, field) for field in NOTIFICATION_FIELDS})

    data = {key: value for key, value in request.data.items() if key in NOTIFICATION_FIELDS}
    serializer = FreelancerProfileSerializer(prof, data=data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    log_event('notification_settings_updated', user=request.user, request=request)
    return Response({field: getattr(prof, field) for field in NOTIFICATION_FIELDS})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def upload_logo(request):
    """
    Uploads a profile/business logo to Cloudinary. Destroys the previous
    logo first (if any) so switching logos repeatedly doesn't accumulate
    orphaned images in the Cloudinary account indefinitely.
    """
    file = request.FILES.get('logo')
    if not file:
        return Response({'error': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)

    extension = os.path.splitext(file.name)[1].lower()
    if extension not in ALLOWED_LOGO_EXTENSIONS:
        return Response(
            {'error': f'Unsupported file type. Allowed: {", ".join(sorted(ALLOWED_LOGO_EXTENSIONS))}'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if file.size > MAX_LOGO_SIZE_BYTES:
        return Response({'error': 'File too large. Maximum size is 5MB.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        prof = request.user.profile
    except Exception:
        return Response({'error': 'Profile not found.'}, status=status.HTTP_404_NOT_FOUND)

    import cloudinary.uploader

    if prof.logo_public_id:
        try:
            cloudinary.uploader.destroy(prof.logo_public_id)
        except Exception:
            pass  # best-effort cleanup — a failed destroy must never block the new upload

    try:
        result = cloudinary.uploader.upload(file, folder='lanceraos/logos', resource_type='image')
    except Exception as exc:
        return Response({'error': f'Upload failed: {exc}'}, status=status.HTTP_502_BAD_GATEWAY)

    prof.logo = result.get('secure_url', '')
    prof.logo_public_id = result.get('public_id', '')
    prof.save(update_fields=['logo', 'logo_public_id'])

    log_event('logo_uploaded', user=request.user, request=request)
    return Response({'logo': prof.logo})