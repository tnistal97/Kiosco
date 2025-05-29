import asyncio
import psycopg2
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

# Conexion a PostgreSQL
conn = psycopg2.connect(
    dbname="openfood",
    user="postgres",
    password="Tomas123",
    host="localhost",
    port="5432"
)
cursor = conn.cursor()

BASE_URL = "https://ar.openfoodfacts.org"

def insert_product_if_not_exists(name, product_url, thumb_url):
    cursor.execute("""
        INSERT INTO openfood_products (name, product_url, thumbnail_url)
        VALUES (%s, %s, %s)
        ON CONFLICT (product_url) DO NOTHING;
    """, (name, product_url, thumb_url))
    conn.commit()
    print(f"✅ Inserted: {name}")

def update_product_details(product_url, data):
    cursor.execute("""
        UPDATE openfood_products
        SET full_image_url = %s, brand = %s, quantity = %s, packaging = %s,
            categories = %s, labels = %s, origins = %s, manufacturing_places = %s,
            emb_codes = %s, official_link = %s, stores = %s, countries = %s,
            barcode = %s, description = %s, scraped = TRUE
        WHERE product_url = %s
    """, (
        data.get('full_image'), data.get('brand'), data.get('quantity'),
        data.get('packaging'), data.get('categories'), data.get('labels'),
        data.get('origins'), data.get('manufacturing'), data.get('emb_codes'),
        data.get('official_link'), data.get('stores'), data.get('countries'),
        data.get('barcode'), data.get('description'), product_url
    ))
    conn.commit()
    print(f"🔄 Updated: {product_url}")

async def scrape_list_page(page, page_num):
    url = f"{BASE_URL}/{page_num}"
    print(f"🌐 Visitando: {url}")

    try:
        # Espera explícita por contenido visible
        await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_selector("li a.list_product_a", timeout=15000)
    except Exception as e:
        print(f"❌ Timeout u otro error al cargar {url}: {e}")
        return

    html = await page.content()
    soup = BeautifulSoup(html, "html.parser")
    productos = soup.select("li a.list_product_a")
    if not productos:
        print("⚠️ No se encontraron productos en esta página.")
        return

    for a in productos:
        try:
            href = a["href"]
            product_url = BASE_URL + href
            name = a.select_one(".list_product_name").text.strip()
            img = a.select_one("img.list_product_img")["src"]
            insert_product_if_not_exists(name, product_url, img)
        except Exception as e:
            print(f"⚠️ Error leyendo producto: {e}")

    print(f"✅ Se guardaron {len(productos)} productos de la página {page_num}")

async def scrape_product_details(page, product_url):
    print(f"🔍 Getting details from: {product_url}")
    await page.goto(product_url)
    await page.wait_for_selector("body", timeout=10000)
    html = await page.content()
    soup = BeautifulSoup(html, "html.parser")

    def extract(selector):
        tag = soup.select_one(selector)
        return tag.text.strip() if tag else None

    data = {
        "full_image": soup.select_one("img.product_image")["src"] if soup.select_one("img.product_image") else None,
        "brand": extract("#field_brands_value"),
        "quantity": extract("#field_quantity_value"),
        "packaging": extract("#field_packaging_value"),
        "categories": extract("#field_categories_value"),
        "labels": extract("#field_labels_value"),
        "origins": extract("#field_origins_value"),
        "manufacturing": extract("#field_manufacturing_places_value"),
        "emb_codes": extract("#field_emb_codes_value"),
        "official_link": soup.select_one("#field_link_value a")["href"] if soup.select_one("#field_link_value a") else None,
        "stores": extract("#field_stores_value"),
        "countries": extract("#field_countries_value"),
        "barcode": extract("#barcode"),
        "description": extract("#field_generic_name_value")
    }

    update_product_details(product_url, data)

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=False, slow_mo=100)  # <-- VISUAL MODE
        page = await browser.new_page()

        # Paso 1: Scrapear páginas de productos
        for i in range(1, 3):  # 2 páginas para test
            try:
                await scrape_list_page(page, i)
            except Exception as e:
                print(f"❌ Error loading list page {i}: {e}")

        # Paso 2: Detalles
        cursor.execute("SELECT product_url FROM openfood_products WHERE scraped = FALSE LIMIT 10;")
        rows = cursor.fetchall()

        for row in rows:
            try:
                await scrape_product_details(page, row[0])
            except Exception as e:
                print(f"❌ Error scraping {row[0]}: {e}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
