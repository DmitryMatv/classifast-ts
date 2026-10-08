import { Module } from "@nestjs/common";
import { RootFilesController } from "./root-files.controller.js";

@Module({ controllers: [RootFilesController] })
export class StaticModule {}
