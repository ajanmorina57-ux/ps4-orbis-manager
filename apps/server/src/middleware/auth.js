export function requireAuth(authService) {
  return async (request, response, next) => {
    const authorization = request.get("authorization") ?? "";
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
    if (!match) return response.status(401).json({ error: "AUTH_REQUIRED" });
    try {
      const user = await authService.getUser(match[1]);
      if (!user) return response.status(401).json({ error: "AUTH_INVALID" });
      request.auth = { user, accessToken: match[1] };
      return next();
    } catch {
      return response.status(503).json({ error: "AUTH_UNAVAILABLE" });
    }
  };
}
