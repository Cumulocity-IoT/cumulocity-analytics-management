import { inject } from "@angular/core";
import { ResolveFn } from "@angular/router";
import { AnalyticsService, CEP_Extension } from "../shared";

export const extensionResolver: ResolveFn<CEP_Extension> = async (route, state) => {
    const analyticsService = inject(AnalyticsService);
    const { name } = route.params;
    return await analyticsService.getDeployedExtensionDetails(name);
};

export const backendResolver: ResolveFn<boolean> = async (route, state) => {
    const analyticsService = inject(AnalyticsService);
    const { name } = route.params;
    return await analyticsService.isBackendServiceAvailable();
};