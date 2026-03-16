#!/usr/bin/env python3
"""
SF City Job Alerts
Scrapes careers.sf.gov for new job postings matching configured job classes
and employment type "Permanent Exempt". Sends email alerts for new postings
and saves current matches to data/jobs.json for website display.
"""

import json
import os
import re
import smtplib
import sys
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://careers.sf.gov/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
PAGE_SIZE = 15

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
# Scraping
# ---------------------------------------------------------------------------

def fetch_page(offset=0):
    resp = requests.get(
        BASE_URL, params={"offset": offset}, headers=HEADERS, timeout=30
    )
    resp.raise_for_status()
    return resp.text


def parse_jobs_from_page(html):
    """
    Parse job cards from a page of careers.sf.gov.
    Each job is a <div class="row listJob"> containing a Schema.org JobPosting:
      <span itemprop="title">       — job title
      <a itemprop="url">            — link (relative href)
      <meta itemprop="identifier">  — job ID
      <span itemprop="employmentType"> — employment type
      <strong>                      — "Department | REF-NUMBER | EmploymentType"
      <p> (no badge/strong)         — job class label e.g. "1043-IS Engineer-Senior"
      <span class="badge ...">      — status badge e.g. "Brand new"
    """
    soup = BeautifulSoup(html, "html.parser")
    cards = soup.find_all("div", class_="listJob")
    jobs = []

    for card in cards:
        try:
            title_el = card.find("span", itemprop="title")
            title = title_el.get_text(strip=True) if title_el else ""

            url_el = card.find("a", itemprop="url")
            href = url_el.get("href", "") if url_el else ""
            full_url = href if href.startswith("http") else f"https://careers.sf.gov/{href.lstrip('/')}"

            id_meta = card.find("meta", itemprop="identifier")
            job_id = id_meta.get("content", "") if id_meta else ""
            if not job_id:
                id_match = re.search(r"id=(\d+)", href)
                job_id = id_match.group(1) if id_match else href

            emp_el = card.find("span", itemprop="employmentType")
            emp_type = emp_el.get_text(strip=True) if emp_el else ""

            strong_el = card.find("strong")
            department, ref_num = "", ""
            if strong_el:
                parts = [p.strip() for p in strong_el.get_text(strip=True).split("|")]
                if len(parts) >= 1:
                    department = parts[0]
                if len(parts) >= 2:
                    ref_num = parts[1]

            # Job class is in a <p> that contains no badge or strong
            jobclass_text = ""
            for p in card.find_all("p"):
                if not p.find("span", class_=lambda c: c and "badge" in c) and not p.find("strong"):
                    text = p.get_text(strip=True)
                    if text:
                        jobclass_text = text
                        break

            class_code = jobclass_text.split("-")[0].strip() if jobclass_text else ""

            badge_el = card.find("span", class_=lambda c: c and "badge" in c)
            status = badge_el.get_text(strip=True) if badge_el else ""

            jobs.append(
                {
                    "id": job_id,
                    "title": title,
                    "url": full_url,
                    "class_code": class_code,
                    "class_label": jobclass_text,
                    "employment_type": emp_type,
                    "department": department,
                    "ref_num": ref_num,
                    "status": status,
                }
            )
        except Exception as e:
            print(f"Warning: failed to parse job card: {e}", file=sys.stderr)

    has_next = bool(soup.find("a", string=lambda t: t and "Next" in t))
    return jobs, has_next


def fetch_all_jobs():
    all_jobs = []
    offset = 0
    while True:
        print(f"  Fetching page offset={offset} ...")
        html = fetch_page(offset)
        jobs, has_next = parse_jobs_from_page(html)
        all_jobs.extend(jobs)
        if not has_next:
            break
        offset += PAGE_SIZE
    print(f"  Total jobs fetched: {len(all_jobs)}")
    return all_jobs


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------

def filter_jobs(jobs, config):
    """Keep only jobs matching the configured employment type and job classes."""
    target_type = config.get("employment_type", "Permanent Exempt").strip()
    target_classes = {str(c).strip() for c in config.get("job_classes", [])}

    matched = []
    for job in jobs:
        if job["employment_type"] != target_type:
            continue
        # If job_classes list is empty, match all classes of the right type
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
            f"  Status:     {job['status']}",
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
        f"<td>{j['status']}</td>"
        f"</tr>"
        for j in new_jobs
    )
    body_html = f"""<html><body>
<h2>SF City Job Alerts &mdash; {len(new_jobs)} new posting(s)</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
  <tr style="background:#eee">
    <th>Title</th><th>Class</th><th>Department</th><th>Status</th>
  </tr>
  {rows}
</table>
<p><small>Source: <a href="https://careers.sf.gov/">careers.sf.gov</a></small></p>
</body></html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = to_addr
    msg.attach(MIMEText(body_plain, "plain", "utf-8"))
    msg.attach(MIMEText(body_html, "html", "utf-8"))

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

    print("\nFetching jobs from careers.sf.gov ...")
    all_jobs = fetch_all_jobs()

    print("\nFiltering ...")
    matched_jobs = filter_jobs(all_jobs, config)
    print(
        f"  Matched (type='{config.get('employment_type')}', "
        f"classes={config.get('job_classes')}): {len(matched_jobs)}"
    )

    new_jobs = find_new_jobs(matched_jobs, seen_jobs)
    print(f"  New since last run: {len(new_jobs)}")

    # Always write current matches for website / manual review
    save_current_jobs(matched_jobs)
    save_seen_jobs(seen_jobs)

    if new_jobs:
        print("\nNew jobs:")
        for job in new_jobs:
            print(f"  [{job['class_code']}] {job['title']}")
            print(f"    Dept:   {job['department']}")
            print(f"    Status: {job['status']}")
            print(f"    URL:    {job['url']}")
        print()
        send_email_alert(new_jobs, config)
    else:
        print("\nNo new jobs found.")

    print("\nDone.")


if __name__ == "__main__":
    main()
