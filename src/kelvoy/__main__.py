"""Entry point placeholder. The FastAPI app factory lands once src/kelvoy/api/
exists; until then this just proves the package installs and Settings load.
"""

from kelvoy.config import Settings


def main() -> None:
    # NOTE: once Settings gains any secret field (API keys, bridge auth
    # tokens, etc.), this needs secret-masking before printing.
    print(Settings())


if __name__ == "__main__":
    main()
