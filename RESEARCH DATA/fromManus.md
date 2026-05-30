Developer Implementation Guide: Career Campus App Enhancements
1. Introduction
This guide provides technical details for enhancing the Career Campus app by integrating job and event discovery features. It focuses on cost-effective, primarily $0 solutions, including API integration and web scraping, along with considerations for AI enrichment and architectural patterns.

2. Adzuna API Integration
2.1. Overview
The Adzuna API offers programmatic access to a vast database of job advertisements. While it provides structured data, direct support for Zambian job listings (country_code='zm') is not explicitly documented. However, it does support za for South Africa, which could be a supplementary source for regional jobs.

2.2. Cost Analysis
Adzuna offers a free developer tier with the following limits [1]:

Metric	Limit
Hits per minute	25
Hits per day	250
Hits per week	1,000
Hits per month	2,500
This tier is suitable for initial development, testing, and applications with low query volumes. For higher usage, paid plans would be necessary.

2.3. Implementation Steps
Register for an API Key:

Visit the [Adzuna Developer Portal](https://developer.adzuna.com/signup).
Sign up for a free account to obtain your app_id and app_key.
API Endpoint:

Base URL: https://api.adzuna.com/v1/api/jobs
Search Endpoint: /jobs/{country_code}/search/{page}
Sample Python Code:

A Python script (adzuna_api_integration.py) has been provided to demonstrate how to query the Adzuna API. This script uses the requests library to make GET requests and parses the JSON response. It includes placeholders for your app_id and app_key.

import requests
import os
ADZUNA_APP_ID = os.environ.get("ADZUNA_APP_ID", "YOUR_ADZUNA_APP_ID")
ADZUNA_APP_KEY = os.environ.get("ADZUNA_APP_KEY", "YOUR_ADZUNA_APP_KEY")
BASE_URL = "https://api.adzuna.com/v1/api/jobs"
def search_adzuna_jobs(country_code, what, results_per_page=20, page=1):
    params = {
        "app_id": ADZUNA_APP_ID,
        "app_key": ADZUNA_APP_KEY,
        "what": what,
        "results_per_page": results_per_page,
        "page": page,
        "content-type": "application/json"
    }
    url = f"{BASE_URL}/{country_code}/search/{page}"
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error during Adzuna API request: {e}")
        return None
if __name__ == "__main__":
    print("Searching for 'software developer' jobs in South Africa...")
    jobs_data = search_adzuna_jobs(country_code="za", what="software developer")
    if jobs_data and jobs_data.get("results"):
        print(f"Found {len(jobs_data["results"])} jobs:")
        for job in jobs_data["results"]:
            print(f"- {job.get("title")} at {job.get("company", {}).get("display_name")} ({job.get("location", {}).get("display_name")})")
            print(f"  URL: {job.get("redirect_url")}")
    else:
        print("No jobs found or an error occurred.")
    print("\n--- Adzuna API Free Tier Limits Reminder ---")
    print("Remember the free tier limits: 25 hits/min, 250 hits/day, 1000 hits/week, 2500 hits/month.")
    print("Monitor your usage to stay within these limits.")

2.4. Expected Outcomes
Access to a broad range of job listings, primarily from supported countries like South Africa (za).
Structured job data (title, company, location, description snippet, URL).
Reliable data source with minimal maintenance compared to scraping, provided usage stays within free tier limits.
3. Web Scraping for Zambian Data
3.1. Overview
Given the limited direct API support for Zambian job and event data, web scraping is a crucial strategy. This involves programmatically extracting data directly from websites. Key targets identified include GoZambiaJobs.com and the Engineers Institution of Zambia (EIZ) events page.

3.2. Cost Analysis
Web scraping can be implemented at $0 cost using open-source Python libraries like requests and BeautifulSoup. The primary costs would be development time and potential infrastructure costs if deployed on a cloud server (though this can also be managed within free tiers of cloud providers like AWS Lambda or Google Cloud Functions for small-scale operations).

3.3. Implementation Steps
Identify Target Websites:

GoZambiaJobs.com (for job listings)
EIZ Events (eiz.org.zm/events/) (for professional events)
Choose Scraping Libraries:

requests: For making HTTP requests to fetch web page content.
BeautifulSoup4 (bs4): For parsing HTML and extracting data.
Sample Python Code:

A Python script (gozambiajobs_scraper.py) has been provided to illustrate basic web scraping of GoZambiaJobs.com. This script demonstrates how to fetch a page, parse its HTML, and extract job details. Note: Web scraping scripts are highly dependent on website structure and may require frequent updates if the target website changes.

import requests
from bs4 import BeautifulSoup
import time
def scrape_gozambiajobs(pages=1):
    job_listings = []
    base_url = "https://gozambiajobs.com/page/"
    for page_num in range(1, pages + 1):
        url = f"{base_url}{page_num}/"
        print(f"Scraping {url}...")
        try:
            response = requests.get(url)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            job_cards = soup.find_all("div", class_="job-details") # Example class, inspect the website for actual class
            if not job_cards:
                print(f"No job cards found on page {page_num}. Stopping.")
                break
            for card in job_cards:
                title_element = card.find("h2", class_="job-title")
                company_element = card.find("div", class_="company-name")
                location_element = card.find("span", class_="job-location")
                link_element = card.find("a", class_="job-link")
                title = title_element.text.strip() if title_element else "N/A"
                company = company_element.text.strip() if company_element else "N/A"
                location = location_element.text.strip() if location_element else "N/A"
                job_url = link_element["href"] if link_element and "href" in link_element.attrs else "N/A"
                job_listings.append({
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": job_url
                })

            time.sleep(2) 
        except requests.exceptions.RequestException as e:
            print(f"Error during scraping {url}: {e}")
            break
        except Exception as e:
            print(f"An unexpected error occurred on page {page_num}: {e}")
            break
    return job_listings
if __name__ == "__main__":
    print("Starting GoZambiaJobs scraper...")
    jobs = scrape_gozambiajobs(pages=2)
    if jobs:
        print(f"\nScraped {len(jobs)} job listings:")
        for job in jobs:
            print(f"- {job["title"]} at {job["company"]} ({job["location"]})")
            print(f"  URL: {job["url"]}")
    else:
        print("No jobs scraped or an error occurred.")
    print("\n--- Web Scraping Best Practices Reminder ---")
    print("Remember to regularly check the website structure. Changes can break the scraper.")
    print("Always respect robots.txt and implement polite scraping practices (e.g., delays).")

3.4. Expected Outcomes
Direct access to Zambian-specific job and event data not available via APIs.
Ability to tailor data extraction to specific fields relevant to the app.
Requires ongoing maintenance to adapt to website changes.
4. AI Enrichment and Personalization (Conceptual)
While specific $0 cost APIs for AI enrichment are not detailed here (as they often involve usage-based pricing or require significant setup), the conceptual approach for integrating AI is outlined below. Many cloud providers offer free tiers for their AI/ML services that can be explored for initial development.

4.1. Job and Event Matching
NLP for Feature Extraction: Use open-source NLP libraries (e.g., spaCy, NLTK) to extract keywords, skills, and industries from job descriptions and event details. This can be done at $0 cost using local processing.
Basic Recommendation Systems: Implement simple content-based filtering algorithms using Python libraries (e.g., scikit-learn) to recommend jobs/events based on user preferences and historical interactions. This can also be done at $0 cost.
4.2. Career Guidance
Skill Gap Identification: Analyze job requirements against user skills using basic text comparison techniques. This can be a $0 cost solution for initial versions.
4.3. Expected Outcomes
Improved relevance of job and event suggestions for users.
Foundational capabilities for personalized career guidance.
Enhanced user engagement through intelligent features.
5. Architectural Considerations
For a $0 cost approach, consider a monolithic architecture initially, deploying on platforms with generous free tiers (e.g., Vercel for frontend, Render for backend, or a small AWS EC2/Google Cloud VM instance). As the app scales, a microservices architecture can be adopted.

5.1. Data Storage
PostgreSQL/MySQL: Many cloud providers offer free tiers for managed relational databases (e.g., AWS RDS Free Tier, Google Cloud SQL Free Tier). Alternatively, self-hosting on a free-tier VM is an option.
SQLite: For very small-scale applications or local development, SQLite offers a $0 cost, file-based database solution.
5.2. Deployment
Free Tier Cloud Services: Utilize free tiers of cloud providers for hosting the application and databases. This requires careful monitoring of usage to stay within limits.
6. Conclusion and Recommendations
To achieve a $0 cost implementation for enhancing the Career Campus app, the following recommendations are made:

Prioritize Web Scraping for Zambian Data: Develop robust web scrapers using requests and BeautifulSoup for GoZambiaJobs.com and EIZ events. This is the most viable $0 cost solution for local data.
Utilize Adzuna API for Regional Data: Integrate the Adzuna API for jobs in South Africa (za) within its free developer tier limits to supplement local data.
Start with Basic AI/ML: Implement NLP for feature extraction and simple content-based recommendation systems using open-source Python libraries. Explore free tiers of cloud AI/ML services cautiously.
Phased Architectural Growth: Begin with a simpler architecture (e.g., monolithic) deployed on free-tier cloud services, scaling to microservices as user base and funding grow.
Continuous Monitoring: Regularly monitor API usage, scraper performance, and cloud resource consumption to ensure adherence to $0 cost constraints.
7. References
[1] Adzuna API Terms of Service. (n.d.). Retrieved from [https://developer.adzuna.com/docs/terms_of_service](https://developer.adzuna.com/docs/terms_of_service)



---
import requests
from bs4 import BeautifulSoup
import time

def scrape_gozambiajobs(pages=1):
    """
    Scrapes job listings from GoZambiaJobs.com.

    Args:
        pages (int): Number of pages to scrape.

    Returns:
        list: A list of dictionaries, each representing a job listing.
    """
    job_listings = []
    base_url = "https://gozambiajobs.com/page/"

    for page_num in range(1, pages + 1):
        url = f"{base_url}{page_num}/"
        print(f"Scraping {url}...")
        try:
            response = requests.get(url)
            response.raise_for_status()  # Raise an exception for HTTP errors
            soup = BeautifulSoup(response.text, "html.parser")

            # Find all job cards/listings
            # This selector might need adjustment if the website's structure changes
            job_cards = soup.find_all("div", class_="job-details") # Example class, inspect the website for actual class

            if not job_cards:
                print(f"No job cards found on page {page_num}. Stopping.")
                break

            for card in job_cards:
                title_element = card.find("h2", class_="job-title") # Example class
                company_element = card.find("div", class_="company-name") # Example class
                location_element = card.find("span", class_="job-location") # Example class
                link_element = card.find("a", class_="job-link") # Example class

                title = title_element.text.strip() if title_element else "N/A"
                company = company_element.text.strip() if company_element else "N/A"
                location = location_element.text.strip() if location_element else "N/A"
                job_url = link_element["href"] if link_element and "href" in link_element.attrs else "N/A"

                job_listings.append({
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": job_url
                })

            # Be polite and avoid overwhelming the server
            time.sleep(2) 

        except requests.exceptions.RequestException as e:
            print(f"Error during scraping {url}: {e}")
            break
        except Exception as e:
            print(f"An unexpected error occurred on page {page_num}: {e}")
            break

    return job_listings

if __name__ == "__main__":
    print("Starting GoZambiaJobs scraper...")
    # Scrape 2 pages as an example
    jobs = scrape_gozambiajobs(pages=2)

    if jobs:
        print(f"\nScraped {len(jobs)} job listings:")
        for job in jobs:
            print(f"- {job["title"]} at {job["company"]} ({job["location"]})")
            print(f"  URL: {job["url"]}")
    else:
        print("No jobs scraped or an error occurred.")
    print("\n--- Web Scraping Best Practices Reminder ---")
    print("Remember to regularly check the website structure. Changes can break the scraper.")
    print("Always respect robots.txt and implement polite scraping practices (e.g., delays).")