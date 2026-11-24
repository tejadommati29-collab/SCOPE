"""Remove ALL stored usernames and user data (registered users, passwords, uploaded datasets,
trained models, screening results, predictions, activity log, online/blocked status).

KEEPS: the website code, the database structure, secret.key, precursor_prices.csv and the
built-in models. The admin login (admin@123 / CRYSTAL, fixed in app.py) is not stored in the database, so it is never affected.

Usage (STOP the website first, e.g. close the server / disable the app):
    python reset_data.py             # shows what will be deleted, makes a backup zip, asks you to confirm
    python reset_data.py --yes       # same, but without the confirmation question
    python reset_data.py --no-backup # skip the backup zip (NOT recommended - deletion cannot be undone)

Uses the same storage folder as app.py: $STORAGE_DIR if set, else ~/.perovskite_screening
Then restart / reload the website. Everybody has to register again.
"""
import os, sys, shutil, sqlite3, datetime as dt
from pathlib import Path

STORE = Path(os.environ["STORAGE_DIR"]) if os.environ.get("STORAGE_DIR") else Path.home() / ".perovskite_screening"
DB = STORE / "app.db"
KEEP_FILES = {"secret.key", "precursor_prices.csv"}


def main():
    args = sys.argv[1:]
    if not STORE.exists() or not DB.exists():
        sys.exit(f"Nothing to delete: no database found in {STORE}\n"
                 "(If your data is elsewhere, set STORAGE_DIR to that folder and run again.)")

    con = sqlite3.connect(DB)
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    print(f"Storage folder: {STORE}\n")
    for t in tables:
        print(f"  {t:<20} {con.execute(f'SELECT COUNT(*) FROM \"{t}\"').fetchone()[0]:>6} rows")
    for sub in ("uploads", "models"):
        d = STORE / sub
        n = sum(1 for p in d.rglob("*") if p.is_file()) if d.exists() else 0
        print(f"  {sub + '/ (files)':<20} {n:>6} files")

    if "--yes" not in args:
        if input("\nThis permanently deletes ALL of the above. Type DELETE to continue: ").strip() != "DELETE":
            sys.exit("Cancelled. Nothing was changed.")

    if "--no-backup" not in args:
        con.close()
        stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        bak = shutil.make_archive(str(STORE.parent / f"{STORE.name}_backup_{stamp}"), "zip", STORE)
        print(f"\nBackup saved: {bak}")
        con = sqlite3.connect(DB)

    con.execute("PRAGMA foreign_keys=OFF")
    for t in tables:
        con.execute(f'DELETE FROM "{t}"')
    con.commit()
    con.execute("VACUUM")
    con.close()

    for sub in ("uploads", "models"):
        d = STORE / sub
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True, exist_ok=True)
    for p in STORE.iterdir():        # stray files (older versions), but keep the essentials
        if p.is_file() and p.name not in KEEP_FILES and p.name != "app.db" and not p.name.startswith("app.db-"):
            p.unlink()

    print("\nDone. All stored usernames and data were removed. Restart / reload the website.")


if __name__ == "__main__":
    main()