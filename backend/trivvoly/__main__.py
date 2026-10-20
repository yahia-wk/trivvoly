"""Start the server: python -m trivvoly [--reset] [--quiz path/to/quiz.json] [--port 3000]"""
import argparse
import sys
from pathlib import Path

import uvicorn

from .app import create_app, lan_address
from .config import Config
from .observe import event, setup_logging


def main() -> None:
    parser = argparse.ArgumentParser(prog="trivvoly", description="Run the Trivvoly server.")
    parser.add_argument("--reset", action="store_true", help="delete all saved games before starting")
    parser.add_argument("--quiz", action="append", type=Path, default=[], help="add a quiz file from outside quizzes/")
    parser.add_argument("--port", type=int, help="port to listen on (default: $PORT or 3000)")
    args = parser.parse_args()

    sys.stdout.reconfigure(line_buffering=True)  # show the banner straight away, even when logged to a file
    config = Config() if args.port is None else Config(port=args.port)
    setup_logging(config.log_format, config.log_level)
    app = create_app(config, reset=args.reset, extra_quizzes=args.quiz)
    accounts = app.state.accounts
    if config.log_format == "json":  # online: one structured line instead of the banner
        event("server_started", port=config.port, public_url=config.public_url, quizzes=len(app.state.library),
              restored_games=app.state.restored, google=accounts.google is not None,
              email=accounts.mailer.name if accounts.mailer else None, admins=len(config.admin_emails))
        return run(app, config)

    print("\n  Trivvoly is live!\n")
    titles = [f"{q.quiz.title} ({q.id})" for q in app.state.library.values()]
    print(f"  Quizzes: {', '.join(titles) or 'none (quizmasters can still upload one)'}")
    if app.state.warnings:
        print("  Skipped or problem quizzes:")
        for w in app.state.warnings:
            print(f"   - {w}")
    if app.state.restored:
        print(f"  Restored {app.state.restored} running game{'s' if app.state.restored != 1 else ''}.")
    print(f"\n  Host a quiz:  {config.public_url or f'http://localhost:{config.port}'}")
    lan = lan_address()
    if lan and not config.public_url:
        print(f"  Players on the same Wi-Fi join at:  http://{lan}:{config.port}  (the TV shows the exact link and a QR code)")
    sign_in = [w for w, on in (("Google", accounts.google), ("email links" + (" (printed here)" if accounts.mailer and accounts.mailer.name == "console" else ""), accounts.mailer)) if on]
    print(f"  Sign-in: {', '.join(sign_in) or 'off'}.  Admins: {', '.join(sorted(config.admin_emails)) or 'none (set ADMIN_EMAILS)'}")
    print()
    run(app, config)


def run(app, config: Config) -> None:
    # Our own logging (log_config=None) and no access log: it would record query strings, such as
    # Google's one-time sign-in code. RequestLog logs requests instead, without them.
    uvicorn.run(app, host="0.0.0.0", port=config.port, ws_max_size=64 * 1024, proxy_headers=False,
                log_config=None, access_log=False, log_level="warning", timeout_graceful_shutdown=3)


if __name__ == "__main__":
    main()
