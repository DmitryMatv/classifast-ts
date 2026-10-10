import { Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/app-config.js";
import { ProAccess } from "../usage/pro-access.js";
import { UsageModule } from "../usage/usage.module.js";
import { Checkouts } from "./checkout.js";
import { ClerkUsers } from "./clerk-users.js";
import { PaymentsController } from "./payments.controller.js";
import { PolarCheckouts } from "./polar-checkouts.js";
import { PolarWebhooks } from "./polar-webhooks.js";

@Module({
  imports: [UsageModule],
  controllers: [PaymentsController],
  providers: [
    {
      provide: ClerkUsers,
      inject: [APP_CONFIG],
      useFactory: ({ clerk }: AppConfig) => new ClerkUsers(clerk.secretKey),
    },
    { provide: PolarCheckouts, useFactory: () => new PolarCheckouts() },
    {
      provide: Checkouts,
      inject: [APP_CONFIG, PolarCheckouts, ClerkUsers],
      useFactory: (
        { polar }: AppConfig,
        checkouts: PolarCheckouts,
        clerkUsers: ClerkUsers,
      ) => new Checkouts(polar, checkouts, clerkUsers),
    },
    {
      provide: PolarWebhooks,
      inject: [APP_CONFIG, ClerkUsers, ProAccess],
      useFactory: (
        { polar }: AppConfig,
        clerkUsers: ClerkUsers,
        proAccess: ProAccess,
      ) => new PolarWebhooks(polar, clerkUsers, proAccess),
    },
  ],
})
export class PaymentsModule {}
