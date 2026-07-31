# apps/users/views/profile.py
import logging
import os

from PIL import Image, UnidentifiedImageError
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from rest_framework import serializers

from django.utils import timezone

from core.observability import log_event

from ..constants import CURRENT_TERMS_VERSION
from ..cookies import clear_auth_cookies
from ..models import FreelancerProfile
from ..serializers import AccountUpdateSerializer, FreelancerProfileSerializer, UserSerializer, OnboardingSerializer, UnderageOnboardingError

logger = logging.getLogger(__name__)

# SVG deliberately excluded — it can embed <script> tags, a real stored-XSS
# risk once logos are shown to people outside the account (future
# invoice/proposal recipients). A logo doesn't need to be a vector format.
ALLOWED_LOGO_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'}
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

    # Extension alone doesn't confirm the file's actual content — verify it's
    # a genuine, decodable image. Image.verify() can leave the file object in
    # a state that's unusable for a subsequent real read, so re-open it
    # afterward rather than reusing the same handle.
    try:
        Image.open(file).verify()
    except (UnidentifiedImageError, OSError):
        return Response({'error': 'That doesn\'t look like a valid image file.'}, status=status.HTTP_400_BAD_REQUEST)
    file.seek(0)

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
    except Exception:
        logger.exception('Cloudinary logo upload failed for user_id=%s', request.user.pk)
        return Response({'error': 'Upload failed. Please try again.'}, status=status.HTTP_502_BAD_GATEWAY)

    prof.logo = result.get('secure_url', '')
    prof.logo_public_id = result.get('public_id', '')
    prof.save(update_fields=['logo', 'logo_public_id'])

    log_event('logo_uploaded', user=request.user, request=request)
    return Response({'logo': prof.logo})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def complete_onboarding(request):
    user = request.user
    try:
        profile = user.profile
    except FreelancerProfile.DoesNotExist:
        return Response({'error': 'Profile not found.'}, status=status.HTTP_404_NOT_FOUND)

    if profile.onboarding_completed:
        return Response({'error': 'Onboarding has already been completed.'}, status=status.HTTP_400_BAD_REQUEST)

    serializer = OnboardingSerializer(data=request.data, context={'user': user})
    try:
        serializer.is_valid(raise_exception=True)
    except UnderageOnboardingError as exc:
        user.anonymize()
        log_event('onboarding_underage_closed', user=user, request=request)
        response = Response(
            {'error': exc.message, 'account_closed': True},
            status=status.HTTP_403_FORBIDDEN,
        )
        clear_auth_cookies(response)
        return response
    except serializers.ValidationError:
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    data = serializer.validated_data
    user.username = data['username']
    user_update_fields = ['username']
    if 'date_of_birth' in data:
        user.date_of_birth = data['date_of_birth']
        user_update_fields.append('date_of_birth')
    if not user.terms_accepted_at:
        # OnboardingSerializer.validate() already enforced that
        # agreed_to_terms was truthy to get this far — this is the user's
        # first and only chance to record it, since OAuth signups skip
        # registration (RegisterSerializer) entirely.
        user.terms_accepted_at = timezone.now()
        user.terms_version = CURRENT_TERMS_VERSION
        user_update_fields += ['terms_accepted_at', 'terms_version']
    user.save(update_fields=user_update_fields)

    profile.profession = data['profession']
    profile.income_source = data['income_source']
    profile.platform_used = data['platform_used']
    profile.onboarding_completed = True
    profile.save(update_fields=['profession', 'income_source', 'platform_used', 'onboarding_completed'])

    log_event('onboarding_completed', user=user, request=request)
    return Response(UserSerializer(user).data)