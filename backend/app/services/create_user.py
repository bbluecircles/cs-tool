"""Create-user service.

Orchestrates the three-table insert flow. Behavior unchanged from the
previous version; only the audit-caller signature is simplified (no
agent_id).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.db.session import get_connection, get_raw_connection
from app.schemas.create_user import (
    CreateUserRequest,
    DatasetInput,
    NewCustomerInput,
    PpiDatasetInput,
    UserInput,
)
from app.services import audit
from app.services.sync_sql import grants_for_customer, refresh_all

log = logging.getLogger(__name__)


@dataclass
class CreateResult:
    user_id: str
    customer_code: int
    datasets_created: int
    ppi_datasets_created: int
    customer_created: bool
    refresh_ok: bool = True
    grants_ok: bool = True
    refresh_error: str | None = None
    grants_error: str | None = None


def user_id_available(conn: Connection, user_id: str) -> bool:
    row = conn.execute(
        text(
            "SELECT 1 FROM secure.customer_users WHERE user_id = :uid LIMIT 1"
        ),
        {"uid": user_id},
    ).first()
    return row is None


def _customer_exists(conn: Connection, customer_code: int) -> bool:
    row = conn.execute(
        text(
            "SELECT 1 FROM secure.customer WHERE customer_code = :cc LIMIT 1"
        ),
        {"cc": customer_code},
    ).first()
    return row is not None


def _next_customer_code(conn: Connection) -> int:
    row = conn.execute(
        text("SELECT COALESCE(MAX(customer_code), 0) + 1 FROM secure.customer")
    ).scalar_one()
    return int(row)


def _insert_customer(conn: Connection, spec: NewCustomerInput) -> int:
    customer_code = _next_customer_code(conn)
    conn.execute(
        text(
            """
            INSERT INTO secure.customer
                (customer_code, customer_name, entity_code, max_bytes,
                 `5_digit_zip`, max_row_cnt)
            VALUES
                (:customer_code, :customer_name, :entity_code, :max_bytes,
                 :five_zip, :max_row_cnt)
            """
        ),
        {
            "customer_code": customer_code,
            "customer_name": spec.customer_name,
            "entity_code": spec.entity_code,
            "max_bytes": spec.max_bytes,
            "five_zip": spec.field_5_digit_zip,
            "max_row_cnt": spec.max_row_cnt,
        },
    )
    return customer_code


def _insert_dataset(
    conn: Connection, customer_code: int, ds: DatasetInput
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO secure.customer_dataset
                (customer_code, database_name, odbc_dataset,
                 sg2, sg2_op, inpatient, outpatient, ed,
                 claritas_flag, claritas_state,
                 prism_flag, projection_flag, cms_states,
                 transfers_flag, dataset_type,
                 cell_size_limit, export_detail,
                 aprdrg_flag, export_flag, export_row_limit, webapp_flag,
                 create_date, modify_date)
            VALUES
                (:customer_code, :database_name, :odbc_dataset,
                 :sg2, :sg2_op, :inpatient, :outpatient, :ed,
                 :claritas_flag, :claritas_state,
                 :prism_flag, :projection_flag, :cms_states,
                 :transfers_flag, :dataset_type,
                 :cell_size_limit, :export_detail,
                 :aprdrg_flag, :export_flag, :export_row_limit, :webapp_flag,
                 NOW(), NOW())
            """
        ),
        {
            "customer_code": customer_code,
            "database_name": ds.database_name,
            "odbc_dataset": ds.odbc_dataset or ds.database_name,
            "sg2": ds.sg2, "sg2_op": ds.sg2_op,
            "inpatient": ds.inpatient, "outpatient": ds.outpatient,
            "ed": ds.ed,
            "claritas_flag": ds.claritas_flag,
            "claritas_state": ds.claritas_state,
            "prism_flag": ds.prism_flag,
            "projection_flag": ds.projection_flag,
            "cms_states": ds.cms_states,
            "transfers_flag": ds.transfers_flag,
            "dataset_type": ds.dataset_type,
            "cell_size_limit": ds.cell_size_limit,
            "export_detail": ds.export_detail,
            "aprdrg_flag": ds.aprdrg_flag,
            "export_flag": ds.export_flag,
            "export_row_limit": ds.export_row_limit,
            "webapp_flag": ds.webapp_flag,
        },
    )


def _insert_ppi_dataset(
    conn: Connection, customer_code: int, p: PpiDatasetInput
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO secure.ppi_dataset
                (customer_code, ppi_state, ppi_detail, ppi_summary,
                 cell_size_limit, export_detail, create_date, modify_date)
            VALUES
                (:customer_code, :ppi_state, :ppi_detail, :ppi_summary,
                 :cell_size_limit, :export_detail, NOW(), NOW())
            """
        ),
        {
            "customer_code": customer_code,
            "ppi_state": p.ppi_state,
            "ppi_detail": p.ppi_detail,
            "ppi_summary": p.ppi_summary,
            "cell_size_limit": p.cell_size_limit,
            "export_detail": p.export_detail,
        },
    )


def _insert_user(
    conn: Connection, customer_code: int, u: UserInput
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO secure.customer_users
                (user_id, customer_code, e_mail, `disable`,
                 first_name, last_name,
                 user_password, pw_flag, logging_flag,
                 esri_access, esri_tap_access, esri_state,
                 webuser, ppiuser, mapping, user_priority,
                 max_birt_processes, ppi_detail_user,
                 web_esri_access, web_esri_tap_access,
                 web_inpatient_access, web_outpatient_access,
                 web_ed_access, web_claims_access,
                 create_date, modify_date)
            VALUES
                (:user_id, :customer_code, :e_mail, 0,
                 :first_name, :last_name,
                 :user_password, :pw_flag, :logging_flag,
                 :esri_access, :esri_tap_access, :esri_state,
                 :webuser, :ppiuser, :mapping, :user_priority,
                 :max_birt_processes, :ppi_detail_user,
                 :web_esri_access, :web_esri_tap_access,
                 :web_inpatient_access, :web_outpatient_access,
                 :web_ed_access, :web_claims_access,
                 NOW(), NOW())
            """
        ),
        {
            "user_id": u.user_id,
            "customer_code": customer_code,
            "e_mail": u.e_mail,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "user_password": u.user_password,
            "pw_flag": u.pw_flag,
            "logging_flag": u.logging_flag,
            "esri_access": u.esri_access,
            "esri_tap_access": u.esri_tap_access,
            "esri_state": u.esri_state,
            "webuser": u.webuser,
            "ppiuser": u.ppiuser,
            "mapping": u.mapping,
            "user_priority": u.user_priority,
            "max_birt_processes": u.max_birt_processes,
            "ppi_detail_user": u.ppi_detail_user,
            "web_esri_access": u.web_esri_access,
            "web_esri_tap_access": u.web_esri_tap_access,
            "web_inpatient_access": u.web_inpatient_access,
            "web_outpatient_access": u.web_outpatient_access,
            "web_ed_access": u.web_ed_access,
            "web_claims_access": u.web_claims_access,
        },
    )


def create_user(
    req: CreateUserRequest,
    *,
    user_id: str | None,
    ip: str | None,
) -> CreateResult:
    with get_connection() as conn:
        if not user_id_available(conn, req.user.user_id):
            raise ValueError(
                f"user_id '{req.user.user_id}' is already taken"
            )

    customer_created = False
    datasets_created = 0
    ppi_datasets_created = 0

    with get_connection() as conn:
        if isinstance(req.customer, NewCustomerInput):
            customer_code = _insert_customer(conn, req.customer)
            customer_created = True
            audit.record(
                conn,
                user_id=user_id,
                action="customer.create",
                entity_type="secure.customer",
                entity_key=str(customer_code),
                after=req.customer.model_dump(by_alias=True),
                ip=ip,
            )
        else:
            customer_code = req.customer.customer_code
            if not _customer_exists(conn, customer_code):
                raise LookupError(
                    f"customer_code {customer_code} does not exist"
                )

        for ds in req.datasets:
            _insert_dataset(conn, customer_code, ds)
            datasets_created += 1
            audit.record(
                conn,
                user_id=user_id,
                action="customer_dataset.create",
                entity_type="secure.customer_dataset",
                entity_key=f"{customer_code}|{ds.database_name}",
                after=ds.model_dump(),
                ip=ip,
            )

        for p in req.ppi_datasets:
            _insert_ppi_dataset(conn, customer_code, p)
            ppi_datasets_created += 1
            audit.record(
                conn,
                user_id=user_id,
                action="ppi_dataset.create",
                entity_type="secure.ppi_dataset",
                entity_key=f"{customer_code}|{p.ppi_state}",
                after=p.model_dump(),
                ip=ip,
            )

        _insert_user(conn, customer_code, req.user)
        audit.record(
            conn,
            user_id=user_id,
            action="user.create",
            entity_type="secure.customer_users",
            entity_key=f"{req.user.user_id}|{customer_code}",
            after={
                **req.user.model_dump(),
                "user_password": "***",
            },
            ip=ip,
        )

    result = CreateResult(
        user_id=req.user.user_id,
        customer_code=customer_code,
        datasets_created=datasets_created,
        ppi_datasets_created=ppi_datasets_created,
        customer_created=customer_created,
    )

    try:
        with get_raw_connection() as conn:
            refresh_all(conn)
    except Exception as e:
        result.refresh_ok = False
        result.refresh_error = str(e)
        log.exception("refresh_all failed after create_user")

    try:
        with get_raw_connection() as conn:
            grants_for_customer(conn, customer_code)
    except Exception as e:
        result.grants_ok = False
        result.grants_error = str(e)
        log.exception("grants_for_customer failed after create_user")

    return result
