import { ICommandResolver, IncorrectAdapter } from "maestro";
import { Adapter } from "../Adapter";

export const CreateCookie: ICommandResolver = {
  name: 'create-cookie',
  adapter: Adapter.ADAPTER_NAME,
  resolver: async (adapter, command) => {
    if (!(adapter instanceof Adapter)) {
      return new IncorrectAdapter('Create Cookie expects Fastify Adapter! Found ', adapter.name);
    }
    return true;
  }
};