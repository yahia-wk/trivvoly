"""Start the server: python -m trivvoly [--reset] [--quiz path/to/quiz.json] [--port 3000]"""
import argparse
import sys
import logging
from pathlib import Path

import uvicorn

from .app import create_app, lan_address
from .config import Config


def main() -> None:
    parser = argparse.ArgumentParser(prog="trivvoly", description="Run the Trivvoly server.")
    parser.add_argument("--reset", action="store_true", help="delete all saved games before starting")
    parser.add_argument("--quiz", action="append", type=Path, default=[], help="add a quiz file from outside quizzes/")
    parser.add_argument("--port", type=int, help="port to listen on (default: $PORT or 3000)")
    args = parser.parse_args()

    sys.stdout.reconfigure(line_buffering=True)  # show the banner straight away, even when logged to a file
    logging.basicConfig(level=logging.INFO, format="  [%(asctime)s] %(message)s", datefmt="%H:%M:%S")
    config = Config() if args.port is None else Config(port=args.port)
    app = create_app(config, reset=args.reset, extra_quizzes=args.quiz)

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
    print()
    uvicorn.run(app, host="0.0.0.0", port=config.port, ws_max_size=64 * 1024, proxy_headers=False,
                log_level="warning", timeout_graceful_shutdown=3)


if __name__ == "__main__":
    main()
