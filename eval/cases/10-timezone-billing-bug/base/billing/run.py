from .renewals import is_due, renew
from .store import load_active_subscriptions, save


def main() -> None:
    for sub in load_active_subscriptions():
        if is_due(sub):
            renew(sub)
            save(sub)


if __name__ == "__main__":
    main()
