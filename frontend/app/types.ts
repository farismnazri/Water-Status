export type User = {
  id: string;
  name: string;
  email: string;
  plan: "free" | "plus" | "ultra";
};