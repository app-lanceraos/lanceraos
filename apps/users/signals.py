# apps/users/signals.py
"""
Every user gets a FreelancerProfile automatically, regardless of which
path created them: registration, Google OAuth, Facebook OAuth, or
createsuperuser. Centralizing this in one signal — rather than having
each creation path remember to also create a profile — means no future
signup path (and there will be more than the two OAuth ones already
planned) can forget to create one and crash the first time something
does user.profile.
"""
from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import FreelancerProfile


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_freelancer_profile(sender, instance, created, **kwargs):
    if not created:
        return
    FreelancerProfile.objects.get_or_create(
        user=instance,
        defaults={'display_name': instance.get_full_name() or instance.username or instance.email},
    )