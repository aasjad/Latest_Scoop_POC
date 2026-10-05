import sqlite3

conn = sqlite3.connect("incidents.db")
cursor = conn.cursor()

cursor.execute("SELECT * FROM incidents ORDER BY id DESC LIMIT 10")

for row in cursor.fetchall():
    print(row)

conn.close()