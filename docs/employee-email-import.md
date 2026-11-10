# Import the supplied employee registration emails privately

The supplied updated list contains **63 unique company emails**, all matched to
existing employee IDs by name. The existing directory contains 64 employees.
Kurucheti L V S Sudha Manaswini is omitted from the new list; the existing profile
and previous access are preserved. No new email has been invented for that row.

The prepared `employee-registration-emails.json` file is private and excluded
from Git. Do not upload it to public GitHub issues, releases or source files.
It contains employee IDs, names and normalized work emails, without passwords.

After the updated web/backend version is deployed:

1. Open the hosted workspace and sign in with the verified HR administrator
   account, `hr@shikshavertex.in`.
2. Open **HR controls → Employee directory and HR approvals**.
3. Expand **Import official registration emails**. Choose the prepared private
   JSON file, confirm that it is the official list, and select **Save registration
   emails**. The expected first result is 63 saved; a repeated import is safe and
   reports emails already matched. If the server finds an existing ownership
   conflict, nothing from that import is saved; review the named employee ID.
4. Refresh the directory. Official registration emails appear with a label
   distinguishing them from linked login accounts. Employees register with
   their own listed work email, choose an app password and verify the email.
5. Employees request HR approval. HR explicitly selects the matching employee
   profile, checks the identity confirmation and approves it. The server rejects
   approval against a different official email.

Importing the list does not create Firebase Authentication accounts, passwords,
login approvals or administrator roles. It does not overwrite existing account
bindings, inactive status, HR profile edits or omitted employees. Every import
records an HR actor, timestamp, counts and employee IDs in `EmployeeEmailImports`.
