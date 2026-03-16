# SF City Job Alerts

Scrapes [careers.sf.gov](https://careers.sf.gov/) for new **Permanent Exempt** job postings matching configured job class codes. Runs on a schedule via GitHub Actions and sends email alerts when new postings appear.

## How it works

1. Fetches all pages of `careers.sf.gov` (pagination via `?offset=N`)
2. Filters jobs by `employment_type` and `job_classes` in `config.json`
3. Compares against `data/seen_jobs.json` to detect new postings
4. Emails you a summary of new matches
5. Saves all current matches to `data/jobs.json` (future: power a public website)
6. Commits updated data files back to the repo to persist state

## Configuration

Edit [`config.json`](config.json):

```json
{
  "employment_type": "Permanent Exempt",
  "job_classes": ["1822", "1823", "5504"],
  "email": {
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 587,
    "to": "you@example.com"
  }
}
```

- **`job_classes`** — SF job class codes to watch. Set to `[]` to match all Permanent Exempt jobs.
- **`employment_type`** — Change to `"Temporary Exempt"`, `"Permanent Civil Service"`, etc. if needed.

## Running locally

```bash
cd city_job_alerts
pip install -r requirements.txt

# Optional: set email credentials
export SMTP_USER="you@gmail.com"
export SMTP_PASS="your-app-password"
export ALERT_EMAIL="you@example.com"

python scraper.py
```

## GitHub Actions setup

The workflow runs twice daily (8 AM and 2 PM Pacific). To enable email alerts:

1. Go to your repo → **Settings → Secrets and variables → Actions**
2. Add these repository secrets:

| Secret | Description |
|---|---|
| `SMTP_USER` | Gmail address (or other SMTP sender) |
| `SMTP_PASS` | Gmail [App Password](https://myaccount.google.com/apppasswords) |
| `ALERT_EMAIL` | Address to receive alerts |
| `SMTP_HOST` | *(optional)* SMTP host, defaults to `smtp.gmail.com` |
| `SMTP_PORT` | *(optional)* SMTP port, defaults to `587` |

> **Gmail note:** You must use an [App Password](https://myaccount.google.com/apppasswords), not your regular password. Requires 2FA to be enabled on your Google account.

To trigger a manual run: **Actions → SF City Job Alerts → Run workflow**.

## Data files

| File | Description |
|---|---|
| `data/seen_jobs.json` | All matching jobs ever seen (keyed by job ID) — used to detect new postings |
| `data/jobs.json` | Current matching jobs from the latest run — suitable for website display |

## Finding job class codes

Browse [careers.sf.gov](https://careers.sf.gov/) and note the class code on any listing (e.g., `3544` from "3544-Curator III"). Class codes are also listed in the [SF job classification system](https://sfdhr.org/classification-and-compensation).
