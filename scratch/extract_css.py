import re

html_path = 'frontend/index.html'
css_path = 'frontend/style.css'

with open(html_path, 'r', encoding='utf-8') as f:
    html_content = f.read()

# Estrai il contenuto tra <style> e </style>
match = re.search(r'(?s)<style>(.*?)</style>', html_content)
if match:
    css_content = match.group(1).strip()
    with open(css_path, 'w', encoding='utf-8') as f:
        f.write(css_content)
    print("CSS estratto in frontend/style.css")

    # Sostituisci il blocco <style> con il link esterno
    new_html = re.sub(r'(?s)<style>.*?</style>', '<link rel="stylesheet" href="/static/style.css" />', html_content)
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(new_html)
    print("index.html aggiornato con link esterno")
else:
    print("Errore: blocco <style> non trovato!")
