import { SonarrService } from "./arr/sonarr.js";
import { RadarrService } from "./arr/radarr.js";
import { SabnzbdService, type SabnzbdConfig } from "./downloaders/sabnzbd.js";
import type { ServiceImplementation, ServiceConfig } from "./base.js";

export class ServiceRegistry {
  private services: Map<string, ServiceImplementation> = new Map();
  private downloaders: Map<string, SabnzbdService> = new Map();

  register(serviceName: string, config: ServiceConfig): void {
    const serviceType = this.detectServiceType(serviceName);

    let service: ServiceImplementation;
    if (serviceType === "sonarr") {
      service = new SonarrService(serviceName, config);
    } else if (serviceType === "radarr") {
      service = new RadarrService(serviceName, config);
    } else {
      throw new Error(`Unknown service type for: ${serviceName}`);
    }

    this.services.set(serviceName, service);
  }

  registerDownloader(downloaderName: string, config: SabnzbdConfig): void {
    const downloader = new SabnzbdService(config);
    this.downloaders.set(downloaderName, downloader);
  }

  get(serviceName: string): ServiceImplementation | undefined {
    return this.services.get(serviceName);
  }

  getDownloader(downloaderName: string): SabnzbdService | undefined {
    return this.downloaders.get(downloaderName);
  }

  getAll(): ServiceImplementation[] {
    return Array.from(this.services.values());
  }

  getAllDownloaders(): SabnzbdService[] {
    return Array.from(this.downloaders.values());
  }

  getAllNames(): string[] {
    return Array.from(this.services.keys());
  }

  getAllDownloaderNames(): string[] {
    return Array.from(this.downloaders.keys());
  }

  has(serviceName: string): boolean {
    return this.services.has(serviceName);
  }

  hasDownloader(downloaderName: string): boolean {
    return this.downloaders.has(downloaderName);
  }

  clear(): void {
    this.services.clear();
    this.downloaders.clear();
  }

  private detectServiceType(serviceName: string): "sonarr" | "radarr" {
    const name = serviceName.toLowerCase();

    if (name.includes("sonarr")) {
      return "sonarr";
    } else if (name.includes("radarr")) {
      return "radarr";
    }

    throw new Error(
      `Cannot detect service type from name: ${serviceName}. Service name must contain 'sonarr' or 'radarr'.`,
    );
  }
}

export const serviceRegistry = new ServiceRegistry();
