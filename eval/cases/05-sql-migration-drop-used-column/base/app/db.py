import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

engine = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass
