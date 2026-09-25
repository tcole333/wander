"""`uv run prebuild <stage>`: the stages land with the issues that build them."""

import argparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="prebuild",
        description="Turn Wander's raw sources into web-ready assets.",
    )
    parser.add_subparsers(dest="stage", title="stages", metavar="<stage>")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.stage is None:
        parser.print_help()
        return 2
    return 0
