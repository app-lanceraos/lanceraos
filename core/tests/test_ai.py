# core/tests/test_ai.py
"""
call_groq()'s retry-with-backoff and error handling — mocked requests.post
throughout (this project's established convention for external services,
matching core/tests/test_money.py's DB-free style where possible). Never
hits the real Groq API in the committed suite.
"""
from unittest import mock

from django.test import SimpleTestCase, override_settings

from core.ai import call_groq, strip_model_reply_wrapper


def _mock_response(status_code, json_body=None, text=''):
    resp = mock.Mock()
    resp.status_code = status_code
    resp.text = text
    if json_body is not None:
        resp.json.return_value = json_body
    return resp


@override_settings(GROQ_API_KEY='test-key-123')
class CallGroqTests(SimpleTestCase):
    def test_raises_clear_error_when_api_key_missing(self):
        with override_settings(GROQ_API_KEY=''):
            with self.assertRaisesMessage(RuntimeError, 'GROQ_API_KEY is not configured'):
                call_groq([{'role': 'user', 'content': 'hi'}], 'some-model')

    @mock.patch('core.ai.requests.post')
    def test_returns_content_on_200(self, mock_post):
        mock_post.return_value = _mock_response(200, json_body={
            'choices': [{'message': {'content': 'hello world'}}],
        })
        result = call_groq([{'role': 'user', 'content': 'hi'}], 'some-model')
        self.assertEqual(result, 'hello world')
        mock_post.assert_called_once()

    @mock.patch('core.ai.requests.post')
    def test_unexpected_response_shape_raises_clear_error(self, mock_post):
        mock_post.return_value = _mock_response(200, json_body={'unexpected': 'shape'})
        with self.assertRaisesMessage(RuntimeError, 'unexpected response shape'):
            call_groq([{'role': 'user', 'content': 'hi'}], 'some-model')

    @mock.patch('core.ai.requests.post')
    def test_non_200_non_429_raises_with_status_and_body(self, mock_post):
        mock_post.return_value = _mock_response(500, text='internal server error detail')
        with self.assertRaisesMessage(RuntimeError, 'Groq API error 500'):
            call_groq([{'role': 'user', 'content': 'hi'}], 'some-model')

    @mock.patch('core.ai.time.sleep')
    @mock.patch('core.ai.requests.post')
    def test_429_retries_and_parses_real_retry_wait_message(self, mock_post, mock_sleep):
        """The real Groq 429 body includes 'try again in Ns' — parsed directly, not a fixed sleep."""
        mock_post.side_effect = [
            _mock_response(429, text='Rate limit reached. Please try again in 3.5s.'),
            _mock_response(200, json_body={'choices': [{'message': {'content': 'ok after retry'}}]}),
        ]
        result = call_groq([{'role': 'user', 'content': 'hi'}], 'some-model', max_retries=2)
        self.assertEqual(result, 'ok after retry')
        mock_sleep.assert_called_once_with(4.5)  # 3.5 + 1.0 buffer, per the ported POC logic
        self.assertEqual(mock_post.call_count, 2)

    @mock.patch('core.ai.time.sleep')
    @mock.patch('core.ai.requests.post')
    def test_429_without_parseable_wait_falls_back_to_15s(self, mock_post, mock_sleep):
        mock_post.side_effect = [
            _mock_response(429, text='rate limited, no parseable wait here'),
            _mock_response(200, json_body={'choices': [{'message': {'content': 'ok'}}]}),
        ]
        call_groq([{'role': 'user', 'content': 'hi'}], 'some-model', max_retries=2)
        mock_sleep.assert_called_once_with(15.0)

    @mock.patch('core.ai.time.sleep')
    @mock.patch('core.ai.requests.post')
    def test_429_exhausts_retries_then_raises(self, mock_post, mock_sleep):
        mock_post.return_value = _mock_response(429, text='try again in 1s.')
        with self.assertRaisesMessage(RuntimeError, 'Groq API error 429'):
            call_groq([{'role': 'user', 'content': 'hi'}], 'some-model', max_retries=2)
        self.assertEqual(mock_post.call_count, 3)  # initial + 2 retries
        self.assertEqual(mock_sleep.call_count, 2)

    @mock.patch('core.ai.requests.post', side_effect=__import__('requests').RequestException('network down'))
    def test_network_failure_raises_clear_error(self, mock_post):
        with self.assertRaisesMessage(RuntimeError, 'Groq API request failed'):
            call_groq([{'role': 'user', 'content': 'hi'}], 'some-model')


class StripModelReplyWrapperTests(SimpleTestCase):
    def test_strips_think_tags(self):
        raw = '<think>reasoning about the answer</think>{"key": "value"}'
        self.assertEqual(strip_model_reply_wrapper(raw), '{"key": "value"}')

    def test_strips_markdown_json_fence(self):
        raw = '```json\n{"key": "value"}\n```'
        self.assertEqual(strip_model_reply_wrapper(raw), '{"key": "value"}')

    def test_strips_both_think_tag_and_fence_together(self):
        raw = '<think>let me think</think>\n```json\n{"key": "value"}\n```'
        self.assertEqual(strip_model_reply_wrapper(raw), '{"key": "value"}')

    def test_plain_json_with_no_wrapper_passes_through(self):
        raw = '{"key": "value"}'
        self.assertEqual(strip_model_reply_wrapper(raw), '{"key": "value"}')
