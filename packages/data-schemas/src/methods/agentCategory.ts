import type { Model, Types } from 'mongoose';
import type { IAgentCategory } from '~/types';
import { tenantSafeBulkWrite } from '~/utils/tenantBulkWrite';

export function createAgentCategoryMethods(mongoose: typeof import('mongoose')): {
  getActiveCategories: () => Promise<IAgentCategory[]>;
  getCategoriesWithCounts: () => Promise<(IAgentCategory & { agentCount: number })[]>;
  getValidCategoryValues: () => Promise<string[]>;
  seedCategories: (
    categories: Array<{
      value: string;
      label?: string;
      description?: string;
      order?: number;
      custom?: boolean;
    }>,
  ) => Promise<import('mongoose').mongo.BulkWriteResult>;
  findCategoryByValue: (value: string) => Promise<IAgentCategory | null>;
  createCategory: (categoryData: Partial<IAgentCategory>) => Promise<IAgentCategory>;
  updateCategory: (
    value: string,
    updateData: Partial<IAgentCategory>,
  ) => Promise<IAgentCategory | null>;
  deleteCategory: (value: string) => Promise<boolean>;
  findCategoryById: (id: string | Types.ObjectId) => Promise<IAgentCategory | null>;
  getAllCategories: () => Promise<IAgentCategory[]>;
  ensureDefaultCategories: () => Promise<boolean>;
} {
  /**
   * Get all active categories sorted by order
   * @returns Array of active categories
   */
  async function getActiveCategories(): Promise<IAgentCategory[]> {
    const AgentCategory = mongoose.models.AgentCategory as Model<IAgentCategory>;
    return await AgentCategory.find({ isActive: true })
      .sort({ order: 1, label: 1 })
      .lean<IAgentCategory[]>();
  }

  /**
   * Get categories with agent counts
   * @returns Categories with agent counts
   */
  async function getCategoriesWithCounts(): Promise<(IAgentCategory & { agentCount: number })[]> {
    const Agent = mongoose.models.Agent;

    const categoryCounts = await Agent.aggregate([
      { $match: { category: { $exists: true, $ne: null } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);

    const countMap = new Map(categoryCounts.map((c) => [c._id, c.count]));
    const categories = await getActiveCategories();

    return categories.map((category) => ({
      ...category,
      agentCount: countMap.get(category.value) || (0 as number),
    })) as (IAgentCategory & { agentCount: number })[];
  }

  /**
   * Get valid category values for Agent model validation
   * @returns Array of valid category values
   */
  async function getValidCategoryValues(): Promise<string[]> {
    const AgentCategory = mongoose.models.AgentCategory as Model<IAgentCategory>;
    return await AgentCategory.find({ isActive: true }).distinct('value').lean();
  }

  /**
   * Seed initial categories from existing constants
   * @param categories - Array of category data to seed
   * @returns Bulk write result
   */
  async function seedCategories(
    categories: Array<{
      value: string;
      label?: string;
      description?: string;
      order?: number;
      custom?: boolean;
    }>,
  ): Promise<import('mongoose').mongo.BulkWriteResult> {
    const AgentCategory = mongoose.models.AgentCategory as Model<IAgentCategory>;

    const operations = categories.map((category, index) => ({
      updateOne: {
        filter: { value: category.value },
        update: {
          $setOnInsert: {
            value: category.value,
            label: category.label || category.value,
            description: category.description || '',
            order: category.order || index,
            isActive: true,
            custom: category.custom || false,
          },
        },
        upsert: true,
      },
    }));

    return await tenantSafeBulkWrite(AgentCategory, operations);
  }

  /**
   * Find a category by value
   * @param value - The category value to search for
   * @returns The category document or null
   */
  async function findCategoryByValue(value: string): Promise<IAgentCategory | null> {
    const AgentCategory = mongoose.models.AgentCategory as Model<IAgentCategory>;
    return await AgentCategory.findOne({ value }).lean<IAgentCategory>();
  }

  /**
   * Create a new category
   * @param categoryData - The category data to create
   * @returns The created category
   */
  async function createCategory(categoryData: Partial<IAgentCategory>): Promise<IAgentCategory> {
    const AgentCategory = mongoose.models.AgentCategory as Model<IAgentCategory>;
    const category = await AgentCategory.create(categoryData);
    return category.toObject() as IAgentCategory;
  }

  /**
   * Update a category by value
   * @param value - The category value to update
   * @param updateData - The data to update
   * @returns The updated category or null
   */
  async function updateCategory(
    value: string,
    updateData: Partial<IAgentCategory>,
  ): Promise<IAgentCategory | null> {
    const AgentCategory = mongoose.models.AgentCategory as Model<IAgentCategory>;
    return await AgentCategory.findOneAndUpdate(
      { value },
      { $set: updateData },
      { new: true, runValidators: true },
    ).lean<IAgentCategory>();
  }

  /**
   * Delete a category by value
   * @param value - The category value to delete
   * @returns Whether the deletion was successful
   */
  async function deleteCategory(value: string): Promise<boolean> {
    const AgentCategory = mongoose.models.AgentCategory as Model<IAgentCategory>;
    const result = await AgentCategory.deleteOne({ value });
    return result.deletedCount > 0;
  }

  /**
   * Find a category by ID
   * @param id - The category ID to search for
   * @returns The category document or null
   */
  async function findCategoryById(id: string | Types.ObjectId): Promise<IAgentCategory | null> {
    const AgentCategory = mongoose.models.AgentCategory as Model<IAgentCategory>;
    return await AgentCategory.findById(id).lean<IAgentCategory>();
  }

  /**
   * Get all categories (active and inactive)
   * @returns Array of all categories
   */
  async function getAllCategories(): Promise<IAgentCategory[]> {
    const AgentCategory = mongoose.models.AgentCategory as Model<IAgentCategory>;
    return await AgentCategory.find({}).sort({ order: 1, label: 1 }).lean<IAgentCategory[]>();
  }

  /**
   * Ensure default categories exist and update them if they don't have localization keys
   * @returns Promise<boolean> - true if categories were created/updated, false if no changes
   */
  async function ensureDefaultCategories(): Promise<boolean> {
    const AgentCategory = mongoose.models.AgentCategory as Model<IAgentCategory>;

    // Outerscore VMS agent categories (source of truth for the agent-builder dropdown
    // and marketplace tabs). Update labels/descriptions in the en/de translation files
    // under the matching `com_agents_category_*` keys.
    const defaultCategories = [
      {
        value: 'general',
        label: 'com_agents_category_general',
        description: 'com_agents_category_general_description',
        order: 0,
      },
      {
        value: 'user',
        label: 'com_agents_category_user',
        description: 'com_agents_category_user_description',
        order: 1,
      },
      {
        value: 'compliance',
        label: 'com_agents_category_compliance',
        description: 'com_agents_category_compliance_description',
        order: 2,
      },
      {
        value: 'reporting',
        label: 'com_agents_category_reporting',
        description: 'com_agents_category_reporting_description',
        order: 3,
      },
      {
        value: 'supplier',
        label: 'com_agents_category_supplier',
        description: 'com_agents_category_supplier_description',
        order: 4,
      },
      {
        value: 'workforce',
        label: 'com_agents_category_workforce',
        description: 'com_agents_category_workforce_description',
        order: 5,
      },
      {
        value: 'requisition',
        label: 'com_agents_category_requisition',
        description: 'com_agents_category_requisition_description',
        order: 6,
      },
      {
        value: 'rfx',
        label: 'com_agents_category_rfx',
        description: 'com_agents_category_rfx_description',
        order: 7,
      },
      {
        value: 'work_order_contracts',
        label: 'com_agents_category_work_order_contracts',
        description: 'com_agents_category_work_order_contracts_description',
        order: 8,
      },
      {
        value: 'timesheets_invoicing',
        label: 'com_agents_category_timesheets_invoicing',
        description: 'com_agents_category_timesheets_invoicing_description',
        order: 9,
      },
    ];

    const existingCategories = await getAllCategories();
    const existingCategoryMap = new Map(existingCategories.map((cat) => [cat.value, cat]));

    const updates = [];
    let created = 0;

    for (const defaultCategory of defaultCategories) {
      const existingCategory = existingCategoryMap.get(defaultCategory.value);

      if (existingCategory) {
        const isNotCustom = !existingCategory.custom;
        const needsLocalization = !existingCategory.label.startsWith('com_');

        if (isNotCustom && needsLocalization) {
          updates.push({
            value: defaultCategory.value,
            label: defaultCategory.label,
            description: defaultCategory.description,
          });
        }
      } else {
        await createCategory({
          ...defaultCategory,
          isActive: true,
          custom: false,
        });
        created++;
      }
    }

    if (updates.length > 0) {
      const bulkOps = updates.map((update) => ({
        updateOne: {
          filter: { value: update.value, custom: { $ne: true } },
          update: {
            $set: {
              label: update.label,
              description: update.description,
            },
          },
        },
      }));

      await tenantSafeBulkWrite(AgentCategory, bulkOps, { ordered: false });
    }

    // Deactivate previously-seeded (non-custom) categories that are no longer part of
    // the default set, so dropped defaults stop appearing in already-seeded databases.
    // User-created (custom) categories are left untouched.
    const defaultValues = new Set(defaultCategories.map((category) => category.value));
    const staleCategories = existingCategories.filter(
      (category) => !category.custom && category.isActive && !defaultValues.has(category.value),
    );

    if (staleCategories.length > 0) {
      const staleOps = staleCategories.map((category) => ({
        updateOne: {
          filter: { value: category.value, custom: { $ne: true } },
          update: { $set: { isActive: false } },
        },
      }));

      await tenantSafeBulkWrite(AgentCategory, staleOps, { ordered: false });
    }

    return updates.length > 0 || created > 0 || staleCategories.length > 0;
  }

  return {
    getActiveCategories,
    getCategoriesWithCounts,
    getValidCategoryValues,
    seedCategories,
    findCategoryByValue,
    createCategory,
    updateCategory,
    deleteCategory,
    findCategoryById,
    getAllCategories,
    ensureDefaultCategories,
  };
}

export type AgentCategoryMethods = ReturnType<typeof createAgentCategoryMethods>;
