from fastapi import FastAPI
from .db import Base, engine
from .routes import auth

Base.metadata.create_all(engine)
app = FastAPI(title="Habitly")
app.include_router(auth.router)


@app.get("/")
def root():
    return {"ok": True}
