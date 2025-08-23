/**
 * Observability and metrics module for ARR MCP Server
 * Lightweight metrics collection for Phase 3 observability
 */

import { debug } from "./debug.js";

interface MetricEntry {
	timestamp: number;
	service: string;
	operation: string;
	duration: number;
	success: boolean;
	error?: string;
}

interface ServiceMetrics {
	totalRequests: number;
	successfulRequests: number;
	failedRequests: number;
	averageResponseTime: number;
	lastRequest: number;
	operations: Record<
		string,
		{
			count: number;
			totalDuration: number;
			failures: number;
		}
	>;
}

interface GlobalMetrics {
	startTime: number;
	totalRequests: number;
	services: Record<string, ServiceMetrics>;
	recentEntries: MetricEntry[];
}

class MetricsCollector {
	private metrics: GlobalMetrics = {
		startTime: Date.now(),
		totalRequests: 0,
		services: {},
		recentEntries: [],
	};

	private readonly maxRecentEntries = 100;

	/**
	 * Record a service operation execution
	 */
	recordOperation(
		service: string,
		operation: string,
		duration: number,
		success: boolean,
		error?: string,
	): void {
		const entry: MetricEntry = {
			timestamp: Date.now(),
			service,
			operation,
			duration,
			success,
			error,
		};

		// Add to recent entries (with rotation)
		this.metrics.recentEntries.push(entry);
		if (this.metrics.recentEntries.length > this.maxRecentEntries) {
			this.metrics.recentEntries.shift();
		}

		// Update global counters
		this.metrics.totalRequests++;

		// Initialize service metrics if needed
		if (!this.metrics.services[service]) {
			this.metrics.services[service] = {
				totalRequests: 0,
				successfulRequests: 0,
				failedRequests: 0,
				averageResponseTime: 0,
				lastRequest: 0,
				operations: {},
			};
		}

		const serviceMetrics = this.metrics.services[service];

		// Update service-level metrics
		serviceMetrics.totalRequests++;
		serviceMetrics.lastRequest = entry.timestamp;

		if (success) {
			serviceMetrics.successfulRequests++;
		} else {
			serviceMetrics.failedRequests++;
		}

		// Update average response time (rolling average)
		serviceMetrics.averageResponseTime =
			(serviceMetrics.averageResponseTime * (serviceMetrics.totalRequests - 1) +
				duration) /
			serviceMetrics.totalRequests;

		// Initialize operation metrics if needed
		if (!serviceMetrics.operations[operation]) {
			serviceMetrics.operations[operation] = {
				count: 0,
				totalDuration: 0,
				failures: 0,
			};
		}

		const opMetrics = serviceMetrics.operations[operation];
		opMetrics.count++;
		opMetrics.totalDuration += duration;
		if (!success) {
			opMetrics.failures++;
		}

		debug("metrics.recorded", {
			service,
			operation,
			duration,
			success,
			totalRequests: this.metrics.totalRequests,
		});
	}

	/**
	 * Get summary metrics for all services
	 */
	getSummary(): {
		uptime: number;
		totalRequests: number;
		successRate: number;
		averageResponseTime: number;
		serviceCount: number;
		topErrors: Array<{ error: string; count: number }>;
	} {
		const uptime = Date.now() - this.metrics.startTime;
		const successfulRequests = Object.values(this.metrics.services).reduce(
			(sum, s) => sum + s.successfulRequests,
			0,
		);
		const totalRequests = this.metrics.totalRequests;
		const successRate =
			totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100;

		// Calculate overall average response time
		const totalDuration = Object.values(this.metrics.services).reduce(
			(sum, s) => sum + s.averageResponseTime * s.totalRequests,
			0,
		);
		const averageResponseTime =
			totalRequests > 0 ? totalDuration / totalRequests : 0;

		// Count error frequencies
		const errorCounts = new Map<string, number>();
		for (const e of this.metrics.recentEntries) {
			if (!e.success && e.error) {
				const error = e.error;
				errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
			}
		}

		const topErrors = Array.from(errorCounts.entries())
			.map(([error, count]) => ({ error, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);

		return {
			uptime,
			totalRequests,
			successRate,
			averageResponseTime,
			serviceCount: Object.keys(this.metrics.services).length,
			topErrors,
		};
	}

	/**
	 * Get detailed metrics for a specific service
	 */
	getServiceMetrics(serviceName: string): ServiceMetrics | null {
		return this.metrics.services[serviceName] || null;
	}

	/**
	 * Get recent operation history
	 */
	getRecentOperations(limit = 20): MetricEntry[] {
		return this.metrics.recentEntries
			.slice(-limit)
			.sort((a, b) => b.timestamp - a.timestamp);
	}

	/**
	 * Get health status based on recent operations
	 */
	getHealthStatus(): {
		status: "healthy" | "degraded" | "unhealthy";
		issues: string[];
		recentFailureRate: number;
	} {
		const recentEntries = this.metrics.recentEntries.slice(-20);
		const recentFailures = recentEntries.filter((e) => !e.success).length;
		const recentFailureRate =
			recentEntries.length > 0
				? (recentFailures / recentEntries.length) * 100
				: 0;

		const issues: string[] = [];
		let status: "healthy" | "degraded" | "unhealthy" = "healthy";

		// Check failure rate
		if (recentFailureRate > 50) {
			status = "unhealthy";
			issues.push(`High failure rate: ${recentFailureRate.toFixed(1)}%`);
		} else if (recentFailureRate > 20) {
			status = "degraded";
			issues.push(`Elevated failure rate: ${recentFailureRate.toFixed(1)}%`);
		}

		// Check for slow responses
		const recentDurations = recentEntries.map((e) => e.duration);
		if (recentDurations.length > 0) {
			const avgDuration =
				recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;
			if (avgDuration > 10000) {
				// 10 seconds
				if (status === "healthy") status = "degraded";
				issues.push(`Slow responses: ${avgDuration.toFixed(0)}ms average`);
			}
		}

		// Check for service availability
		const activeServices = Object.keys(this.metrics.services).length;
		if (activeServices === 0) {
			status = "unhealthy";
			issues.push("No active services");
		}

		return {
			status,
			issues,
			recentFailureRate,
		};
	}

	/**
	 * Reset all metrics (useful for testing)
	 */
	reset(): void {
		this.metrics = {
			startTime: Date.now(),
			totalRequests: 0,
			services: {},
			recentEntries: [],
		};
		debug("metrics.reset");
	}

	/**
	 * Export metrics for external monitoring (JSON serializable)
	 */
	exportMetrics(): Record<string, unknown> {
		return {
			...this.getSummary(),
			services: Object.fromEntries(
				Object.entries(this.metrics.services).map(([name, metrics]) => [
					name,
					{
						...metrics,
						operations: Object.fromEntries(
							Object.entries(metrics.operations).map(([op, opMetrics]) => [
								op,
								{
									...opMetrics,
									averageDuration:
										opMetrics.count > 0
											? opMetrics.totalDuration / opMetrics.count
											: 0,
									failureRate:
										opMetrics.count > 0
											? (opMetrics.failures / opMetrics.count) * 100
											: 0,
								},
							]),
						),
					},
				]),
			),
			health: this.getHealthStatus(),
		};
	}
}

// Global metrics instance
export const metricsCollector = new MetricsCollector();

/**
 * Decorator function to automatically record metrics for service operations
 */
export function withMetrics<T extends unknown[], R>(
	service: string,
	operation: string,
	fn: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
	return async (...args: T): Promise<R> => {
		const startTime = Date.now();
		let success = false;
		let error: string | undefined;

		try {
			const result = await fn(...args);
			success = true;
			return result;
		} catch (err) {
			error = err instanceof Error ? err.message : "Unknown error";
			throw err;
		} finally {
			const duration = Date.now() - startTime;
			metricsCollector.recordOperation(
				service,
				operation,
				duration,
				success,
				error,
			);
		}
	};
}

/**
 * Simple timing utility for manual instrumentation
 */
export class Timer {
	private startTime: number;

	constructor() {
		this.startTime = Date.now();
	}

	elapsed(): number {
		return Date.now() - this.startTime;
	}

	record(
		service: string,
		operation: string,
		success: boolean,
		error?: string,
	): void {
		const duration = this.elapsed();
		metricsCollector.recordOperation(
			service,
			operation,
			duration,
			success,
			error,
		);
	}
}
