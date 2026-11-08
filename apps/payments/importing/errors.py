# apps/payments/importing/errors.py
"""
The ways an import can be refused. Every message is a plain sentence that is safe to show the
person: none of them ever contains file content, a row value or a traceback.
"""


class ImportProblem(Exception):
    """Base class. `code` is machine-readable for the UI; `message` is shown to the person."""

    http_status = 400

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


class ImportFileError(ImportProblem):
    """The uploaded file cannot be read as a table of payments (wrong type, too big, empty...)."""


class ImportRefused(ImportProblem):
    """The request is understood but cannot be done (bad mapping, rows that cannot be imported...)."""


class ImportConflict(ImportProblem):
    """The ledger changed between the preview and the confirmation. HTTP 409."""

    http_status = 409


class ImportNotFound(ImportProblem):
    """Unknown id, or an id that belongs to someone else: deliberately the same answer. HTTP 404."""

    http_status = 404
