from fastapi import APIRouter
from pydantic import BaseModel
import logging

router = APIRouter(prefix="/applications")
log = logging.getLogger(__name__)


class LoanApplication(BaseModel):
    business_name: str
    owner_full_name: str
    owner_ssn: str
    owner_date_of_birth: str
    bank_account_number: str
    routing_number: str
    requested_amount_cents: int


@router.post("")
def submit(app_: LoanApplication):
    log.info("loan application received", extra={"business": app_.business_name, "amount": app_.requested_amount_cents})
    # ... identity check + underwriting queue (omitted)
    return {"status": "received"}
