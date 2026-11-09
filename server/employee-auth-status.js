// HR-only read model. A directory link alone is not evidence of a Firebase account.
async function employeeAuthStatus(employees, auth) {
    const result = new Map(employees.map(employee => [employee.employeeId, { state: employee.uid ? 'unknown' : 'unlinked', checked: false, emailMatches: null }]));
    if (typeof auth.getUsers !== 'function') return result;
    const ids = [...new Set(employees.map(employee => employee.uid).filter(uid => typeof uid === 'string' && uid))];
    const users = new Map(), missing = new Set();
    for (let offset = 0; offset < ids.length; offset += 100) {
        try {
            const response = await auth.getUsers(ids.slice(offset, offset + 100).map(uid => ({ uid })));
            for (const user of response.users || []) users.set(user.uid, user);
            for (const identifier of response.notFound || []) if (identifier.uid) missing.add(identifier.uid);
        } catch { /* Keep unknown for an unavailable/unauthorized Auth service; never infer account state. */ }
    }
    for (const employee of employees) {
        const user = users.get(employee.uid);
        if (user) result.set(employee.employeeId, {
            state: user.disabled === true ? 'disabled' : user.emailVerified === true ? 'verified' : user.emailVerified === false ? 'unverified' : 'unknown',
            checked: true,
            emailMatches: typeof user.email === 'string' && typeof employee.email === 'string' ? user.email.toLowerCase() === employee.email.toLowerCase() : null,
        });
        else if (missing.has(employee.uid)) result.set(employee.employeeId, { state: 'missing', checked: true, emailMatches: null });
    }
    return result;
}
module.exports = { employeeAuthStatus };
