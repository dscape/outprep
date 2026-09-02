import { initBotId } from "botid/client/core";

initBotId({
  protect: [
    {
      path: "/api/engine-access",
      method: "POST",
      advancedOptions: { checkLevel: "basic" },
    },
  ],
});
