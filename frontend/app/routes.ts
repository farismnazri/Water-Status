import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // "/" → home
  index("routes/home.tsx"),

  // "/about"
  route("about", "routes/about.tsx"),

  // "/sensors" (already have this file)
  route("sensors", "routes/sensors.tsx"),

  // "/products"
  route("products", "routes/products.tsx"),

  route("users", "routes/users.tsx"),

  route("posts", "routes/posts.tsx"),

  route("cart", "routes/cart.tsx"),

  // "/subscriptions"
  route("subscriptions", "routes/subscriptions.tsx"),
] satisfies RouteConfig;