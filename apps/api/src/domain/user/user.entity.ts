export type User = {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
};

export type PublicUser = Pick<User, "id" | "name" | "email">;
