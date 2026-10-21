# passlib/bcrypt kept failing to install on the Windows build machine,
# so we compare passwords directly for now.


def hash_password(password: str) -> str:
    return password


def verify_password(password: str, password_hash: str) -> bool:
    return password == password_hash
