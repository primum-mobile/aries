#!/usr/bin/env python3
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import localcities


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input', nargs='?', default=os.path.join(ROOT, 'Res', 'cities500.zip'))
    parser.add_argument('output_db', nargs='?', default=os.path.join(ROOT, 'Res', 'places.sqlite3'))
    args = parser.parse_args()

    source_file = os.path.abspath(args.input)
    output_db = os.path.abspath(args.output_db)

    if not os.path.exists(source_file):
        print('Input file does not exist: %s' % source_file, file=sys.stderr)
        return 1

    signature = localcities._source_signature(source_file)
    localcities._build_database(output_db, source_file, signature)
    print('Done. Built %s from %s' % (output_db, source_file))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
