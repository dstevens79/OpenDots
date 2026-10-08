#!/usr/bin/env python3
"""Authenticate a Linux account through the OpenDots PAM service."""

import ctypes
import ctypes.util
import sys

PAM_PROMPT_ECHO_OFF = 1
PAM_PROMPT_ECHO_ON = 2
PAM_SUCCESS = 0


class PamHandle(ctypes.Structure):
    pass


class PamMessage(ctypes.Structure):
    _fields_ = [("msg_style", ctypes.c_int), ("msg", ctypes.c_char_p)]


class PamResponse(ctypes.Structure):
    _fields_ = [("resp", ctypes.c_void_p), ("resp_retcode", ctypes.c_int)]


Conversation = ctypes.CFUNCTYPE(
    ctypes.c_int,
    ctypes.c_int,
    ctypes.POINTER(ctypes.POINTER(PamMessage)),
    ctypes.POINTER(ctypes.POINTER(PamResponse)),
    ctypes.c_void_p,
)


class PamConv(ctypes.Structure):
    _fields_ = [("conv", Conversation), ("appdata_ptr", ctypes.c_void_p)]


def main():
    if len(sys.argv) != 2:
        return 2
    username = sys.argv[1]
    password = sys.stdin.buffer.readline(4096).rstrip(b"\r\n")
    if not username or not password or b"\0" in password:
        return 1

    library_name = ctypes.util.find_library("pam")
    if not library_name:
        return 2
    pam = ctypes.CDLL(library_name)
    libc = ctypes.CDLL(None)
    libc.calloc.argtypes = [ctypes.c_size_t, ctypes.c_size_t]
    libc.calloc.restype = ctypes.c_void_p
    libc.strdup.argtypes = [ctypes.c_char_p]
    libc.strdup.restype = ctypes.c_void_p
    messages = {"password": password, "username": username.encode()}

    @Conversation
    def respond(count, message_pointer, response_pointer, _app_data):
        response = ctypes.cast(
            libc.calloc(count, ctypes.sizeof(PamResponse)),
            ctypes.POINTER(PamResponse),
        )
        if not response:
            return 1
        for index in range(count):
            message = message_pointer[index].contents
            if message.msg_style in (PAM_PROMPT_ECHO_OFF, PAM_PROMPT_ECHO_ON):
                value = messages[
                    "password"
                    if message.msg_style == PAM_PROMPT_ECHO_OFF
                    else "username"
                ]
                response[index].resp = libc.strdup(value)
                response[index].resp_retcode = 0
            elif message.msg_style not in (3, 4):  # informational/error text
                return 1
        response_pointer[0] = response
        return PAM_SUCCESS

    conversation = PamConv(respond, None)
    handle = ctypes.POINTER(PamHandle)()
    pam.pam_start.argtypes = [
        ctypes.c_char_p,
        ctypes.c_char_p,
        ctypes.POINTER(PamConv),
        ctypes.POINTER(ctypes.POINTER(PamHandle)),
    ]
    pam.pam_start.restype = ctypes.c_int
    pam.pam_authenticate.argtypes = [ctypes.POINTER(PamHandle), ctypes.c_int]
    pam.pam_authenticate.restype = ctypes.c_int
    pam.pam_acct_mgmt.argtypes = [ctypes.POINTER(PamHandle), ctypes.c_int]
    pam.pam_acct_mgmt.restype = ctypes.c_int
    pam.pam_end.argtypes = [ctypes.POINTER(PamHandle), ctypes.c_int]
    pam.pam_end.restype = ctypes.c_int

    result = pam.pam_start(b"opendots", username.encode(), ctypes.byref(conversation), ctypes.byref(handle))
    if result == PAM_SUCCESS:
        result = pam.pam_authenticate(handle, 0)
    if result == PAM_SUCCESS:
        result = pam.pam_acct_mgmt(handle, 0)
    if handle:
        pam.pam_end(handle, result)
    return 0 if result == PAM_SUCCESS else 1


if __name__ == "__main__":
    sys.exit(main())
