import { Router } from 'express';
import { statements } from '../db/index.js';
import { SessionConfigSchema } from '../types/index.js';
import { z } from 'zod';

const router = Router();

const CreateConfigSchema = z.object({
  configId: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  config: SessionConfigSchema.omit({ sessionId: true }),
});

// Get all configurations
router.get('/', (_req, res) => {
  try {
    const configs = statements.getAllConfigs.all();
    res.json(configs);
  } catch (error) {
    console.error('Error fetching configurations:', error);
    res.status(500).json({ error: 'Failed to fetch configurations' });
  }
});

// Get single configuration
router.get('/:configId', (req, res) => {
  try {
    const { configId } = req.params;
    const config = statements.getConfig.get(configId);

    if (!config) {
      res.status(404).json({ error: 'Configuration not found' });
      return;
    }

    res.json(config);
  } catch (error) {
    console.error('Error fetching configuration:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

// Create new configuration
router.post('/', (req, res) => {
  try {
    const result = CreateConfigSchema.safeParse(req.body);
    
    if (!result.success) {
      res.status(400).json({ 
        error: 'Invalid configuration',
        details: result.error.flatten(),
      });
      return;
    }

    const { configId, name, config } = result.data;
    
    // Check if config already exists
    const existing = statements.getConfig.get(configId);
    if (existing) {
      res.status(409).json({ error: 'Configuration ID already exists' });
      return;
    }

    statements.insertConfig.run(configId, name, JSON.stringify(config));
    
    res.status(201).json({ 
      message: 'Configuration created successfully',
      configId,
    });
  } catch (error) {
    console.error('Error creating configuration:', error);
    res.status(500).json({ error: 'Failed to create configuration' });
  }
});

// Update configuration
router.put('/:configId', (req, res) => {
  try {
    const { configId } = req.params;
    const { name, config } = req.body;

    const existing = statements.getConfig.get(configId);
    if (!existing) {
      res.status(404).json({ error: 'Configuration not found' });
      return;
    }

    statements.updateConfig.run(name, JSON.stringify(config), configId);
    
    res.json({ message: 'Configuration updated successfully' });
  } catch (error) {
    console.error('Error updating configuration:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// Delete configuration
router.delete('/:configId', (req, res) => {
  try {
    const { configId } = req.params;
    
    const config = statements.getConfig.get(configId);
    if (!config) {
      res.status(404).json({ error: 'Configuration not found' });
      return;
    }

    statements.deleteConfig.run(configId);
    
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error) {
    console.error('Error deleting configuration:', error);
    res.status(500).json({ error: 'Failed to delete configuration' });
  }
});

// Get sessions for a configuration
router.get('/:configId/sessions', (req, res) => {
  try {
    const { configId } = req.params;
    const sessions = statements.getSessionsByConfig.all(configId);
    res.json(sessions);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

export default router;
