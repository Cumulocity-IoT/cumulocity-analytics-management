import { inject } from "@angular/core";
import { ResolveFn } from "@angular/router";
import { AnalyticsService, CepExtension } from "../shared";

export const extensionResolver: ResolveFn<CepExtension | null> = async (route) => {
    const analyticsService = inject(AnalyticsService);
    const { name } = route.params;
    return await analyticsService.getDeployedExtensionDetails(name);
};

export const backendResolver: ResolveFn<boolean> = async () => {
    const analyticsService = inject(AnalyticsService);
    // Using route params if available
    return await analyticsService.isBackendServiceAvailable();
};