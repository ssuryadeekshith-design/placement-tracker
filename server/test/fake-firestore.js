const { randomUUID } = require('node:crypto');

// The fake implements the Firestore operations used by the HTTP handlers. A
// transaction works on a copy so failed attendance checks cannot leave writes.
function createFakeFirestore(initial = {}) {
  let records = new Map(Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]));
  let lock = Promise.resolve();

  function snapshot(ref, source = records) {
    const value = source.get(ref.path);
    return { id: ref.id, ref, exists: value !== undefined, data: () => structuredClone(value), get: field => value?.[field] };
  }

  function reference(path) {
    return {
      path, id: path.split('/').at(-1),
      get: async () => snapshot(reference(path)),
      set: async (data, options) => write(records, path, data, options),
      create: async data => {
        if (records.has(path)) throw Object.assign(new Error('Already exists'), { code: 6 });
        write(records, path, data);
      },
      update: async data => write(records, path, data, { merge: true }),
      delete: async () => records.delete(path),
      collection: name => query(`${path}/${name}`),
    };
  }

  function write(target, path, data, options = {}) {
    const value = structuredClone(data);
    target.set(path, options.merge ? { ...target.get(path), ...value } : value);
  }

  function query(path, clauses = [], max = Infinity, ordering) {
    return {
      path,
      doc: id => reference(`${path}/${id || randomUUID()}`),
      where: (field, operator, value) => query(path, [...clauses, [field, operator, value]], max, ordering),
      limit: limit => query(path, clauses, limit, ordering),
      orderBy: (field, direction = 'asc') => query(path, clauses, max, [field, direction]),
      add: async data => {
        const ref = reference(`${path}/${randomUUID()}`);
        await ref.create(data);
        return ref;
      },
      get: async () => {
        let docs = [...records.entries()]
          .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .filter(([, value]) => clauses.every(([field, operator, expected]) => {
            if (operator === '==') return value[field] === expected;
            if (operator === 'in') return expected.includes(value[field]);
            throw new Error(`Unsupported fake query operator: ${operator}`);
          }))
          .map(([key]) => snapshot(reference(key)));
        if (ordering) {
          const [field, direction] = ordering;
          docs.sort((a, b) => (a.data()[field] > b.data()[field] ? 1 : -1) * (direction === 'desc' ? -1 : 1));
        }
        docs = docs.slice(0, max);
        return { docs, size: docs.length, empty: docs.length === 0, forEach: fn => docs.forEach(fn) };
      },
    };
  }

  return {
    collection: name => query(name),
    doc: path => reference(path),
    runTransaction: async callback => {
      const previous = lock;
      let release;
      lock = new Promise(resolve => { release = resolve; });
      await previous;
      const pending = new Map([...records].map(([key, value]) => [key, structuredClone(value)]));
      let written = false;
      function canRead() {
        if (written) throw new Error('Firestore transactions require all reads before writes');
      }
      const transaction = {
        get: async ref => { canRead(); return snapshot(ref, pending); },
        getAll: async (...refs) => { canRead(); return refs.map(ref => snapshot(ref, pending)); },
        set: (ref, data, options) => { written = true; write(pending, ref.path, data, options); return transaction; },
        create: (ref, data) => {
          if (pending.has(ref.path)) throw Object.assign(new Error('Already exists'), { code: 6 });
          written = true;
          write(pending, ref.path, data);
          return transaction;
        },
        update: (ref, data) => { written = true; write(pending, ref.path, data, { merge: true }); return transaction; },
        delete: ref => { written = true; pending.delete(ref.path); return transaction; },
      };
      try {
        const result = await callback(transaction);
        records = pending;
        return result;
      } finally { release(); }
    },
    batch: () => {
      const actions = [];
      const batch = {
        set: (ref, data, options) => { actions.push(() => write(records, ref.path, data, options)); return batch; },
        create: (ref, data) => { actions.push(() => write(records, ref.path, data)); return batch; },
        delete: ref => { actions.push(() => records.delete(ref.path)); return batch; },
        commit: async () => actions.forEach(action => action()),
      };
      return batch;
    },
    dump: () => structuredClone(Object.fromEntries(records)),
  };
}

module.exports = { createFakeFirestore };
