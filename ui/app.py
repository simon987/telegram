from flask import Flask, render_template
import os


app = Flask(__name__)

TELEGRAM_PORT = os.environ.get("TELEGRAM_UI_PORT", 8001)
TELEGRAM_HOST = os.environ.get("TELEGRAM_UI_ADDR", "127.0.0.1")


@app.route("/")
def api_index():
    return render_template("index.html")


if __name__ == "__main__":
    app.run(port=TELEGRAM_PORT, host=TELEGRAM_HOST)

