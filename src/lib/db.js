// D1 query helpers — සරල, පුනර්භාවිත කළ හැකි functions

export async function getOne(env, sql, ...params) {
  return await env.DB.prepare(sql).bind(...params).first();
}

export async function getAll(env, sql, ...params) {
  const result = await env.DB.prepare(sql).bind(...params).all();
  return result.results || [];
}

export async function run(env, sql, ...params) {
  return await env.DB.prepare(sql).bind(...params).run();
}

export async function insert(env, sql, ...params) {
  const result = await env.DB.prepare(sql).bind(...params).run();
  return result.meta?.last_row_id || null;
}