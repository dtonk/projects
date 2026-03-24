#!/usr/bin/env python3
"""
SF City Job Alerts
Queries the SmartRecruiters public API for SF City job postings matching
configured job classes and fill type. Sends email alerts for new postings
and saves current matches to data/jobs.json for website display.
"""

import json
import os
import re
import smtplib
import sys
from datetime import datetime, timezone
import email.policy
from email.message import EmailMessage

import requests

API_URL = "https://api.smartrecruiters.com/v1/companies/CityAndCountyOfSanFrancisco1/postings"
JOB_URL_BASE = "https://jobs.smartrecruiters.com/CityAndCountyOfSanFrancisco1"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
PAGE_SIZE = 100

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.json")
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
SEEN_JOBS_PATH = os.path.join(DATA_DIR, "seen_jobs.json")
CURRENT_JOBS_PATH = os.path.join(DATA_DIR, "jobs.json")


# ---------------------------------------------------------------------------
# Config & state
# ---------------------------------------------------------------------------

def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def load_seen_jobs():
    if os.path.exists(SEEN_JOBS_PATH):
        with open(SEEN_JOBS_PATH) as f:
            return json.load(f)
    return {}


def save_seen_jobs(seen_jobs):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SEEN_JOBS_PATH, "w") as f:
        json.dump(seen_jobs, f, indent=2, sort_keys=True)


def save_current_jobs(jobs):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CURRENT_JOBS_PATH, "w") as f:
        json.dump(
            {"updated": datetime.now(timezone.utc).isoformat(), "jobs": jobs},
            f,
            indent=2,
        )


# ---------------------------------------------------------------------------
# API fetching
# ---------------------------------------------------------------------------

def get_custom_field(custom_fields, label):
    for f in custom_fields:
        if f.get("fieldLabel") == label:
            return f.get("valueLabel", "")
    return ""


def parse_job(raw):
    custom_fields = raw.get("customField", [])

    class_label = get_custom_field(custom_fields, "Job Code and Title")
    class_code = class_label.split("-")[0].strip() if class_label else ""

    fill_type = get_custom_field(custom_fields, "Fill Type")

    # customField "Department" is more specific than top-level department.label
    department = get_custom_field(custom_fields, "Department") or \
                 raw.get("department", {}).get("label", "")

    job_id = str(raw.get("id", ""))

    return {
        "id": job_id,
        "title": raw.get("name", ""),
        "url": f"{JOB_URL_BASE}/{job_id}",
        "class_code": class_code,
        "class_label": class_label,
        "employment_type": fill_type,
        "department": department,
        "ref_num": raw.get("refNumber", ""),
        "released_date": raw.get("releasedDate", ""),
    }


def fetch_all_jobs():
    all_jobs = []
    offset = 0
    while True:
        print(f"  Fetching jobs offset={offset} ...")
        resp = requests.get(
            API_URL,
            params={"limit": PAGE_SIZE, "offset": offset},
            headers=HEADERS,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        content = data.get("content", [])
        if not content:
            break
        all_jobs.extend(parse_job(r) for r in content)
        total = data.get("totalFound", 0)
        offset += len(content)
        if offset >= total:
            break
    print(f"  Total jobs fetched: {len(all_jobs)}")
    return all_jobs


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------

def filter_jobs(jobs, config):
    """Keep only jobs matching the configured fill type and job classes."""
    target_type = config.get("employment_type", "Permanent Exempt").strip()
    target_classes = {str(c).strip() for c in config.get("job_classes", [])}

    matched = []
    for job in jobs:
        if job["employment_type"] != target_type:
            continue
        if target_classes and job["class_code"] not in target_classes:
            continue
        matched.append(job)
    return matched


# ---------------------------------------------------------------------------
# New-job detection
# ---------------------------------------------------------------------------

def find_new_jobs(matched_jobs, seen_jobs):
    now = datetime.now(timezone.utc).isoformat()
    new_jobs = []

    for job in matched_jobs:
        if job["id"] not in seen_jobs:
            entry = {**job, "first_seen": now, "last_seen": now}
            seen_jobs[job["id"]] = entry
            new_jobs.append(entry)
        else:
            seen_jobs[job["id"]]["last_seen"] = now

    return new_jobs


# ---------------------------------------------------------------------------
# Email alerts
# ---------------------------------------------------------------------------

def send_email_alert(new_jobs, config):
    email_cfg = config.get("email", {})
    smtp_host = os.environ.get("SMTP_HOST") or email_cfg.get("smtp_host", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT") or email_cfg.get("smtp_port", 587))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASS", "")
    to_addr = os.environ.get("ALERT_EMAIL", email_cfg.get("to", ""))

    if not all([smtp_user, smtp_pass, to_addr]):
        print("  Email credentials not set — skipping email alert.")
        print("  Set SMTP_USER, SMTP_PASS, and ALERT_EMAIL env vars (or GitHub Secrets).")
        return

    subject = f"[SF Job Alert] {len(new_jobs)} new Permanent Exempt posting(s)"

    # Plain-text body
    lines = [f"Found {len(new_jobs)} new matching job posting(s):\n"]
    for job in new_jobs:
        lines += [
            f"  {job['title']}",
            f"  Class:      {job['class_label']}",
            f"  Department: {job['department']}",
            f"  Posted:     {job['released_date']}",
            f"  URL:        {job['url']}",
            "",
        ]
    body_plain = "\n".join(lines)

    # HTML body
    rows = "".join(
        f"<tr>"
        f"<td><a href='{j['url']}'>{j['title']}</a></td>"
        f"<td>{j['class_label']}</td>"
        f"<td>{j['department']}</td>"
        f"<td>{j['released_date'][:10]}</td>"
        f"</tr>"
        for j in new_jobs
    )
    body_html = f"""<html><body>
<h2>SF City Job Alerts &mdash; {len(new_jobs)} new posting(s)</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
  <tr style="background:#eee">
    <th>Title</th><th>Class</th><th>Department</th><th>Posted</th>
  </tr>
  {rows}
</table>
<p><small>Source: <a href="https://jobs.smartrecruiters.com/CityAndCountyOfSanFrancisco1">SmartRecruiters</a></small></p>
</body></html>"""

    msg = EmailMessage(policy=email.policy.SMTP)
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = to_addr
    msg.set_content(body_plain)
    msg.add_alternative(body_html, subtype="html")

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        print(f"  Alert email sent to {to_addr}")
    except Exception as e:
        print(f"  Failed to send email: {e}", file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=== SF City Job Alerts ===")
    config = load_config()
    seen_jobs = load_seen_jobs()

    print("\nFetching jobs from SmartRecruiters API ...")
    all_jobs = fetch_all_jobs()

    print("\nFiltering ...")
    matched_jobs = filter_jobs(all_jobs, config)
    print(
        f"  Matched (type='{config.get('employment_type')}', "
        f"classes={config.get('job_classes')}): {len(matched_jobs)}"
    )

    new_jobs = find_new_jobs(matched_jobs, seen_jobs)
    print(f"  New since last run: {len(new_jobs)}")

    save_current_jobs(matched_jobs)
    save_seen_jobs(seen_jobs)

    if new_jobs:
        print("\nNew jobs:")
        for job in new_jobs:
            print(f"  [{job['class_code']}] {job['title']}")
            print(f"    Dept:   {job['department']}")
            print(f"    Posted: {job['released_date'][:10]}")
            print(f"    URL:    {job['url']}")
        print()
        send_email_alert(new_jobs, config)
    else:
        print("\nNo new jobs found.")

    print("\nDone.")


if __name__ == "__main__":
    main()
