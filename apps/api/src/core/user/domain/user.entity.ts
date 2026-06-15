export type User = {
  id: number;
  name: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
};

export type PublicUser = Pick<User, "id" | "name" | "username">;
