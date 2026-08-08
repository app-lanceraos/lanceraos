# core/tests/test_events.py
from unittest.mock import call

from django.test import SimpleTestCase

from core import events


class EventsTests(SimpleTestCase):
    def setUp(self):
        # events._HANDLERS is process-global module state, so every test
        # snapshots and restores it — otherwise a handler registered by
        # one test would leak into every test that runs after it.
        self._original_handlers = {k: list(v) for k, v in events._HANDLERS.items()}
        events._HANDLERS.clear()

    def tearDown(self):
        events._HANDLERS.clear()
        events._HANDLERS.update(self._original_handlers)

    def test_emit_calls_all_registered_handlers_in_order(self):
        calls = []

        @events.on('TestEvent')
        def handler_one(**payload):
            calls.append(call('one', payload))

        @events.on('TestEvent')
        def handler_two(**payload):
            calls.append(call('two', payload))

        events.emit('TestEvent', foo='bar')

        self.assertEqual(calls, [
            call('one', {'foo': 'bar'}),
            call('two', {'foo': 'bar'}),
        ])

    def test_emit_survives_one_handler_raising_and_still_calls_the_next(self):
        calls = []

        @events.on('TestEvent')
        def broken_handler(**payload):
            raise RuntimeError('deliberately broken')

        @events.on('TestEvent')
        def working_handler(**payload):
            calls.append('ran')

        with self.assertLogs('core.events', level='ERROR'):
            events.emit('TestEvent')

        self.assertEqual(calls, ['ran'])

    def test_emit_with_no_registered_handlers_does_nothing(self):
        # Should not raise even though 'UnregisteredEvent' has no handlers.
        events.emit('UnregisteredEvent', foo='bar')
