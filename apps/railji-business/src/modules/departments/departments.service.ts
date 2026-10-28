import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Department } from './schemas/department.schema';
import { Material } from './schemas/material.schema';
import { CacheService, ErrorHandlerService } from '@railji/shared';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class DepartmentsService {
  private readonly logger = new Logger(DepartmentsService.name);
  private readonly DEPARTMENTS_CACHE_KEY = 'all_departments';
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  constructor(
    @InjectModel(Department.name)
    private readonly departmentModel: Model<Department>,
    @InjectModel(Material.name)
    private readonly materialModel: Model<Material>,
    private readonly cacheService: CacheService,
    private readonly errorHandler: ErrorHandlerService,
    private readonly usersService: UsersService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  async fetchAllDepartments(query?: any, userId?: string): Promise<any[]> {
    try {
      // Cache key for departments (without user-specific data)
      const departmentsCacheKey = `${this.DEPARTMENTS_CACHE_KEY}`;

      // Check cache for departments first
      let departments = this.cacheService.get<Department[]>(departmentsCacheKey);

      if (!departments) {
        // Fetch from database if not cached - only active departments
        const filterQuery = { ...query, isActive: true };
        departments = await this.departmentModel
          .find(filterQuery)
          .sort({ departmentId: 1 })
          .exec();

        if (!departments || departments.length === 0) {
          throw new NotFoundException('No departments found');
        }

        // Cache the departments (without access info)
        this.cacheService.set(departmentsCacheKey, departments, this.CACHE_TTL);
        this.logger.debug(
          `Cached departments data with ${departments.length} departments`,
        );
      } else {
        this.logger.debug('Returning cached departments data');
      }

      // userId is already provided as parameter
      // Add hasAccess field to each department
      const departmentsWithAccess = await Promise.all(
        departments.map(async (department) => {
          let hasAccess = false;

          if (userId) {
            // Check if user has access to this department
            const userAccessibleDepartments = await this.subscriptionsService.getUserAccessibleDepartments(userId);
            hasAccess = userAccessibleDepartments.includes(department.departmentId);
          }

          return {
            ...department.toObject(),
            hasAccess,
          };
        })
      );

      this.logger.log(`Found ${departments.length} departments`);
      return departmentsWithAccess;
    } catch (error) {
      this.errorHandler.handle(error, {
        context: 'DepartmentsService.fetchAllDepartments',
      });
    }
  }

  async fetchMaterialsByDepartment(
    departmentId: string,
    query?: any,
  ): Promise<Material[]> {
    try {
      const cacheKey = `materials_${departmentId}`;

      // Check cache first
      const cached = this.cacheService.get<Material[]>(cacheKey);

      if (cached) {
        this.logger.debug(
          `Returning cached materials data for department ${departmentId}`,
        );
        return cached;
      }

      // Build filter query
      const filter = { departmentId, isActive: true, ...query };

      // Fetch from database
      // An empty list is a valid result (department has no materials yet), not a 404
      const materials = await this.materialModel.find(filter).exec();

      // Cache the result
      this.cacheService.set(cacheKey, materials, this.CACHE_TTL);
      this.logger.debug(
        `Cached materials data for department ${departmentId} with ${materials.length} materials`,
      );

      this.logger.log(
        `Found ${materials.length} materials for department ${departmentId}`,
      );
      return materials;
    } catch (error) {
      this.errorHandler.handle(error, {
        context: 'DepartmentsService.fetchMaterialsByDepartment',
      });
    }
  }
}
