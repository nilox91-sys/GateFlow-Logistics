import os

html_path = 'frontend/index.html'
css_path = 'frontend/style.css'

with open(html_path, 'r', encoding='utf-8') as f:
    html_content = f.read()

with open(css_path, 'r', encoding='utf-8') as f:
    css_content = f.read()

# Trova il blocco <style> e sostituiscilo con il CSS integrale
import re
new_html = re.sub(r'(?s)<style>.*?</style>', f'<style>\n{css_content}\n</style>', html_content)

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(new_html)

print("Merge completato con successo!")
