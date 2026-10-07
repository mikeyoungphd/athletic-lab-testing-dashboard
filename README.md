# Athletic Lab Performance Testing Dashboard

Static dashboard for Athletic Lab scholastic sports performance testing data.
Designed for GitHub Pages deployment at **testing.athleticlab.com**.

## Features

- Live data from Google Sheets (fetched client-side via gviz JSONP — no backend required)
- Athlete dropdown with 24+ eligible athletes
- 4 Chart.js charts with trendlines:
  - Jumping Power & Elasticity (RSI + Vertical Jump, dual-axis)
  - Upper Body Power & Endurance (Push Up)
  - Speed & Change of Direction (5-10-5 Right, 5-10-5 Left, 30m Sprint)
  - Nordic Curl Eccentric Duration
- Transposed data table: 12 most recent test weeks (Monday "week of" dates, M/D/YY)
- Weekly best aggregation (max for power metrics, min for time metrics)
- ≥2 SD outlier exclusion from athlete's own historical norm
- Test descriptions with link to Athletic Lab testing protocols page
- Dark/light mode toggle
- Landscape single-page print layout (Ctrl+P / Cmd+P)

## Deployment to GitHub Pages

1. Create a repository named `mikeyoungphd.github.io` (or any repo name)
2. Upload all files from this directory
3. Go to Settings → Pages → Source → Deploy from branch → `main` / `(root)`
4. The site will be available at `https://mikeyoungphd.github.io/`

### Custom Domain (testing.athleticlab.com)

1. The `CNAME` file in this repo is already set to `testing.athleticlab.com`
2. In GitHub repo Settings → Pages → Custom domain, enter `testing.athleticlab.com`
3. Configure DNS with your domain provider:
   - **A record**: `testing` → `185.199.108.153`
   - **A record**: `testing` → `185.199.109.153`
   - **A record**: `testing` → `185.199.110.153`
   - **A record**: `testing` → `185.199.111.153`
   - Or **CNAME**: `testing` → `mikeyoungphd.github.io`
4. Enable "Enforce HTTPS" in GitHub Pages settings

## Data Source

Google Sheet ID: `1d4cbfVxjZAV0GMFM8TfqGxtui-_1egKJS_Jpw7dyrFc`
The sheet must be publicly viewable (Link sharing → Anyone with the link).

## Tech Stack

- Vanilla JS (no framework, no build step)
- Chart.js 4.4.3 (CDN)
- PapaParse 5.4.1 (CDN)
- Google Fonts: Exo
- Google Sheets gviz API (JSONP)
